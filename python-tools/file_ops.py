#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件操作工具集
提供安全的文件系统操作，包含路径白名单和黑名单校验
"""

import os
import sys
import shutil
import fnmatch
import datetime
from pathlib import Path

# ========== 安全配置 ==========

# 运行时从环境变量读取允许的根路径，默认为用户家目录
_allowed_roots_env = os.environ.get('WORKFLOW_ALLOWED_ROOTS', '')
if _allowed_roots_env:
    ALLOWED_ROOTS = [os.path.normpath(p.strip()) for p in _allowed_roots_env.split(';') if p.strip()]
else:
    ALLOWED_ROOTS = [os.path.normpath(os.path.expanduser('~'))]

# 绝对禁止访问的路径
BLOCKED_PATHS = [
    os.path.normpath('C:\\Windows'),
    os.path.normpath('C:\\Program Files'),
    os.path.normpath('C:\\Program Files (x86)'),
    os.path.normpath('C:\\ProgramData'),
]

# 禁止操作的文件扩展名
BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.dll', '.sys', '.msi']

# 文件大小限制
MAX_READ_SIZE = 1 * 1024 * 1024    # 1 MB
MAX_WRITE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_LIST_COUNT = 1000              # 列出文件最大条数
MAX_RECURSIVE_DEPTH = 5            # 递归深度上限


def validate_path(path: str) -> str:
    """
    校验并规范化路径，防止路径穿越攻击
    返回: 规范化后的绝对路径
    """
    if not path or not isinstance(path, str):
        raise ValueError('路径不能为空')

    # 展开 ~ 为用户主目录
    path = os.path.expanduser(path)
    # 转换为绝对路径
    path = os.path.abspath(path)
    # 解析符号链接
    path = os.path.realpath(path)
    # 规范化路径分隔符
    path = os.path.normpath(path)

    # 黑名单检查（优先于白名单）
    path_lower = path.lower()
    for blocked in BLOCKED_PATHS:
        if path_lower.startswith(blocked.lower()):
            raise PermissionError(f'禁止访问系统路径: {path}')

    # 白名单检查
    in_allowed = False
    for allowed in ALLOWED_ROOTS:
        if path_lower.startswith(allowed.lower()):
            in_allowed = True
            break
    if not in_allowed:
        raise PermissionError(f'路径不在允许范围内: {path}')

    return path


def _check_extension(path: str):
    """检查文件扩展名是否被禁止"""
    ext = os.path.splitext(path)[1].lower()
    if ext in BLOCKED_EXTENSIONS:
        raise PermissionError(f'禁止操作此类型文件: {ext}')


def _format_time(timestamp: float) -> str:
    """格式化时间戳为 ISO 格式字符串"""
    return datetime.datetime.fromtimestamp(timestamp).isoformat()


def _file_info(path: str) -> dict:
    """获取单个文件/目录的基本信息"""
    stat = os.stat(path)
    return {
        'name': os.path.basename(path),
        'size': stat.st_size,
        'modified': _format_time(stat.st_mtime),
        'is_dir': os.path.isdir(path),
    }


# ========== 工具函数 ==========


def list_files(path: str, filter: str = '*', recursive: bool = False) -> dict:
    """
    列出指定目录下的文件
    :param path: 目录路径
    :param filter: 文件名过滤器，如 '*.jpg'
    :param recursive: 是否递归子目录
    :return: {files: [{name, size, modified, is_dir}], total: int}
    """
    path = validate_path(path)

    if not os.path.isdir(path):
        raise FileNotFoundError(f'目录不存在: {path}')

    files = []
    count = 0

    if recursive:
        for root, dirs, filenames in os.walk(path):
            # 检查递归深度
            depth = root.replace(path, '').count(os.sep)
            if depth >= MAX_RECURSIVE_DEPTH:
                dirs.clear()  # 不再深入
                continue

            # 先处理目录
            for d in dirs:
                if count >= MAX_LIST_COUNT:
                    break
                full_path = os.path.join(root, d)
                if fnmatch.fnmatch(d, filter):
                    try:
                        files.append(_file_info(full_path))
                        count += 1
                    except OSError:
                        pass

            # 再处理文件
            for f in filenames:
                if count >= MAX_LIST_COUNT:
                    break
                if fnmatch.fnmatch(f, filter):
                    full_path = os.path.join(root, f)
                    try:
                        files.append(_file_info(full_path))
                        count += 1
                    except OSError:
                        pass

            if count >= MAX_LIST_COUNT:
                break
    else:
        try:
            entries = os.listdir(path)
        except PermissionError:
            raise PermissionError(f'无权限读取目录: {path}')

        for entry in entries:
            if count >= MAX_LIST_COUNT:
                break
            if fnmatch.fnmatch(entry, filter):
                full_path = os.path.join(path, entry)
                try:
                    files.append(_file_info(full_path))
                    count += 1
                except OSError:
                    pass

    return {'files': files, 'total': len(files)}


def read_file(path: str) -> dict:
    """
    读取文本文件内容
    :param path: 文件路径
    :return: {content: str, size: int, encoding: str}
    """
    path = validate_path(path)
    _check_extension(path)

    if not os.path.isfile(path):
        raise FileNotFoundError(f'文件不存在: {path}')

    file_size = os.path.getsize(path)
    if file_size > MAX_READ_SIZE:
        raise ValueError(f'文件过大: {file_size} 字节，最大允许 {MAX_READ_SIZE} 字节 (1MB)')

    # 尝试多种编码
    for encoding in ['utf-8', 'gbk', 'gb2312', 'latin-1']:
        try:
            with open(path, 'r', encoding=encoding) as f:
                content = f.read()
            return {'content': content, 'size': file_size, 'encoding': encoding}
        except (UnicodeDecodeError, UnicodeError):
            continue

    raise ValueError(f'无法解码文件，不是文本文件或编码不支持: {path}')


def write_file(path: str, content: str, create_dirs: bool = True) -> dict:
    """
    写入/创建文本文件
    :param path: 文件路径
    :param content: 文件内容
    :param create_dirs: 是否自动创建父目录
    :return: {path: str, bytes_written: int}
    """
    path = validate_path(path)
    _check_extension(path)

    # 检查内容大小
    content_bytes = content.encode('utf-8')
    if len(content_bytes) > MAX_WRITE_SIZE:
        raise ValueError(f'内容过大: {len(content_bytes)} 字节，最大允许 {MAX_WRITE_SIZE} 字节 (10MB)')

    # 创建父目录
    parent_dir = os.path.dirname(path)
    if create_dirs and not os.path.exists(parent_dir):
        os.makedirs(parent_dir, exist_ok=True)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

    return {'path': path, 'bytes_written': len(content_bytes)}


def move_file(src: str, dst: str, overwrite: bool = False) -> dict:
    """
    移动/重命名文件
    :param src: 源路径
    :param dst: 目标路径
    :param overwrite: 是否覆盖已存在的目标文件
    :return: {src: str, dst: str}
    """
    src = validate_path(src)
    dst = validate_path(dst)
    _check_extension(src)
    _check_extension(dst)

    if not os.path.exists(src):
        raise FileNotFoundError(f'源文件不存在: {src}')

    if os.path.exists(dst) and not overwrite:
        raise ValueError(f'目标文件已存在: {dst}，设置 overwrite=true 可覆盖')

    # 确保目标目录存在
    dst_dir = os.path.dirname(dst)
    if not os.path.exists(dst_dir):
        os.makedirs(dst_dir, exist_ok=True)

    shutil.move(src, dst)
    return {'src': src, 'dst': dst}


def copy_file(src: str, dst: str, overwrite: bool = False) -> dict:
    """
    复制文件
    :param src: 源路径
    :param dst: 目标路径
    :param overwrite: 是否覆盖已存在的目标文件
    :return: {src: str, dst: str}
    """
    src = validate_path(src)
    dst = validate_path(dst)
    _check_extension(src)
    _check_extension(dst)

    if not os.path.exists(src):
        raise FileNotFoundError(f'源文件不存在: {src}')

    if os.path.exists(dst) and not overwrite:
        raise ValueError(f'目标文件已存在: {dst}，设置 overwrite=true 可覆盖')

    # 确保目标目录存在
    dst_dir = os.path.dirname(dst)
    if not os.path.exists(dst_dir):
        os.makedirs(dst_dir, exist_ok=True)

    if os.path.isdir(src):
        shutil.copytree(src, dst, dirs_exist_ok=overwrite)
    else:
        shutil.copy2(src, dst)

    return {'src': src, 'dst': dst}


def delete_file(path: str, use_trash: bool = True) -> dict:
    """
    删除文件（默认移到回收站）
    :param path: 文件路径
    :param use_trash: 是否使用回收站（True=回收站，False=永久删除）
    :return: {path: str, method: str}
    """
    path = validate_path(path)
    _check_extension(path)

    if not os.path.exists(path):
        raise FileNotFoundError(f'文件不存在: {path}')

    # 禁止删除非空目录
    if os.path.isdir(path) and os.listdir(path):
        raise ValueError(f'禁止删除非空目录: {path}')

    if use_trash:
        try:
            from send2trash import send2trash
            send2trash(path)
            return {'path': path, 'method': 'trash'}
        except ImportError:
            # send2trash 不可用，回退到永久删除但先警告
            print('[file_ops] send2trash 不可用，将永久删除文件', file=sys.stderr)

    # 永久删除
    if os.path.isdir(path):
        os.rmdir(path)  # 只能删空目录
    else:
        os.remove(path)

    return {'path': path, 'method': 'permanent'}


def get_file_info(path: str) -> dict:
    """
    获取文件详细信息
    :param path: 文件路径
    :return: {name, path, size, modified, created, is_dir, extension}
    """
    path = validate_path(path)

    if not os.path.exists(path):
        raise FileNotFoundError(f'文件不存在: {path}')

    stat = os.stat(path)
    is_dir = os.path.isdir(path)

    return {
        'name': os.path.basename(path),
        'path': path,
        'size': stat.st_size,
        'modified': _format_time(stat.st_mtime),
        'created': _format_time(stat.st_ctime),
        'is_dir': is_dir,
        'extension': '' if is_dir else os.path.splitext(path)[1].lower(),
    }


def search_files(path: str, pattern: str, content_search: str = None, recursive: bool = True) -> dict:
    """
    按名称/内容搜索文件
    :param path: 搜索根目录
    :param pattern: 文件名匹配模式（glob），如 '*.txt'
    :param content_search: 文件内容搜索关键词（可选）
    :param recursive: 是否递归搜索
    :return: {files: [...], total: int}
    """
    path = validate_path(path)

    if not os.path.isdir(path):
        raise FileNotFoundError(f'目录不存在: {path}')

    results = []
    count = 0

    if recursive:
        for root, dirs, filenames in os.walk(path):
            # 递归深度限制
            depth = root.replace(path, '').count(os.sep)
            if depth >= MAX_RECURSIVE_DEPTH:
                dirs.clear()
                continue

            for f in filenames:
                if count >= MAX_LIST_COUNT:
                    break
                if not fnmatch.fnmatch(f, pattern):
                    continue

                full_path = os.path.join(root, f)

                # 如果需要内容搜索
                if content_search:
                    try:
                        file_size = os.path.getsize(full_path)
                        if file_size > MAX_READ_SIZE:
                            continue  # 跳过大文件
                        with open(full_path, 'r', encoding='utf-8', errors='ignore') as fh:
                            content = fh.read()
                        if content_search.lower() not in content.lower():
                            continue
                    except (OSError, UnicodeError):
                        continue

                try:
                    info = _file_info(full_path)
                    info['path'] = full_path
                    results.append(info)
                    count += 1
                except OSError:
                    pass

            if count >= MAX_LIST_COUNT:
                break
    else:
        try:
            entries = os.listdir(path)
        except PermissionError:
            raise PermissionError(f'无权限读取目录: {path}')

        for entry in entries:
            if count >= MAX_LIST_COUNT:
                break
            if not fnmatch.fnmatch(entry, pattern):
                continue

            full_path = os.path.join(path, entry)
            if not os.path.isfile(full_path):
                continue

            # 内容搜索
            if content_search:
                try:
                    file_size = os.path.getsize(full_path)
                    if file_size > MAX_READ_SIZE:
                        continue
                    with open(full_path, 'r', encoding='utf-8', errors='ignore') as fh:
                        content = fh.read()
                    if content_search.lower() not in content.lower():
                        continue
                except (OSError, UnicodeError):
                    continue

            try:
                info = _file_info(full_path)
                info['path'] = full_path
                results.append(info)
                count += 1
            except OSError:
                pass

    return {'files': results, 'total': len(results)}
