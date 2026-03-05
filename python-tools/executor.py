#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Python 工具执行器 - 主入口
通过 stdin/stdout 单行 JSON 协议与 Electron 主进程通信
"""

import sys
import json
import traceback
import importlib

# 工具模块映射
TOOL_MODULES = {
    'file_ops': None,   # 懒加载
    'system_ops': None, # 懒加载
}


def get_module(module_name: str):
    """懒加载工具模块"""
    if module_name not in TOOL_MODULES:
        return None
    if TOOL_MODULES[module_name] is None:
        try:
            TOOL_MODULES[module_name] = importlib.import_module(module_name)
        except ImportError as e:
            print(f'[executor] 模块加载失败: {module_name} - {e}', file=sys.stderr)
            return None
    return TOOL_MODULES[module_name]


def list_tools() -> list:
    """返回所有可用工具清单"""
    tools = []

    # file_ops 工具
    file_ops_tools = [
        {'name': 'file_ops.list_files', 'description': '列出指定目录下的文件，支持过滤器', 'category': 'file', 'safe': True},
        {'name': 'file_ops.read_file', 'description': '读取文本文件内容', 'category': 'file', 'safe': True},
        {'name': 'file_ops.write_file', 'description': '写入/创建文本文件', 'category': 'file', 'safe': False},
        {'name': 'file_ops.move_file', 'description': '移动/重命名文件', 'category': 'file', 'safe': False},
        {'name': 'file_ops.copy_file', 'description': '复制文件', 'category': 'file', 'safe': True},
        {'name': 'file_ops.delete_file', 'description': '删除文件（默认移到回收站）', 'category': 'file', 'safe': False},
        {'name': 'file_ops.get_file_info', 'description': '获取文件详细信息', 'category': 'file', 'safe': True},
        {'name': 'file_ops.search_files', 'description': '按名称/内容搜索文件', 'category': 'file', 'safe': True},
    ]

    # system_ops 工具
    system_ops_tools = [
        {'name': 'system_ops.open_app', 'description': '打开应用程序（白名单限制）', 'category': 'system', 'safe': False},
        {'name': 'system_ops.open_url', 'description': '在浏览器中打开 URL', 'category': 'system', 'safe': True},
        {'name': 'system_ops.get_system_info', 'description': '获取系统信息', 'category': 'system', 'safe': True},
        {'name': 'system_ops.set_clipboard', 'description': '设置剪贴板文本', 'category': 'system', 'safe': True},
    ]

    tools.extend(file_ops_tools)
    tools.extend(system_ops_tools)
    return tools


def handle_request(request: dict) -> dict:
    """处理单个请求，返回响应字典"""
    request_id = request.get('request_id', 'unknown')
    tool = request.get('tool', '')
    params = request.get('params', {})

    # 特殊命令：心跳
    if tool == '__ping__':
        return {'request_id': request_id, 'success': True, 'result': 'pong'}

    # 特殊命令：关闭
    if tool == '__shutdown__':
        return {'request_id': request_id, 'success': True, 'result': 'shutdown'}

    # 特殊命令：列出工具
    if tool == '__list_tools__':
        return {'request_id': request_id, 'success': True, 'result': list_tools()}

    # 解析模块名和函数名
    parts = tool.split('.', 1)
    if len(parts) != 2:
        return {
            'request_id': request_id,
            'success': False,
            'error': {'code': 'TOOL_NOT_FOUND', 'message': f'工具名格式错误: {tool}，应为 module.function'}
        }

    module_name, func_name = parts

    # 加载模块
    module = get_module(module_name)
    if module is None:
        return {
            'request_id': request_id,
            'success': False,
            'error': {'code': 'TOOL_NOT_FOUND', 'message': f'未知工具模块: {module_name}'}
        }

    # 获取函数
    func = getattr(module, func_name, None)
    if func is None or not callable(func):
        return {
            'request_id': request_id,
            'success': False,
            'error': {'code': 'TOOL_NOT_FOUND', 'message': f'工具函数不存在: {tool}'}
        }

    # 执行函数
    try:
        result = func(**params)
        return {'request_id': request_id, 'success': True, 'result': result}
    except PermissionError as e:
        return {
            'request_id': request_id,
            'success': False,
            'error': {'code': 'PERMISSION_DENIED', 'message': str(e)}
        }
    except FileNotFoundError as e:
        return {
            'request_id': request_id,
            'success': False,
            'error': {'code': 'FILE_NOT_FOUND', 'message': str(e)}
        }
    except ValueError as e:
        return {
            'request_id': request_id,
            'success': False,
            'error': {'code': 'INVALID_PARAMS', 'message': str(e)}
        }
    except Exception as e:
        return {
            'request_id': request_id,
            'success': False,
            'error': {'code': 'EXECUTION_ERROR', 'message': str(e)}
        }


def main():
    """主循环：从 stdin 读取 JSON 请求，通过 stdout 输出 JSON 响应"""
    # 通知 Electron 已就绪
    print('[executor] ready', file=sys.stderr)
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            # JSON 解析失败，返回错误
            error_resp = {
                'request_id': 'unknown',
                'success': False,
                'error': {'code': 'INVALID_PARAMS', 'message': f'JSON 解析失败: {e}'}
            }
            print(json.dumps(error_resp, ensure_ascii=False), flush=True)
            continue

        # 处理请求
        response = handle_request(request)

        # 输出响应（单行 JSON）
        print(json.dumps(response, ensure_ascii=False, default=str), flush=True)

        # 如果是关闭命令，退出循环
        if request.get('tool') == '__shutdown__':
            print('[executor] shutting down', file=sys.stderr)
            sys.stderr.flush()
            break


if __name__ == '__main__':
    main()
