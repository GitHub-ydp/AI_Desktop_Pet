#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
系统操作工具集
提供安全的系统级操作，包含白名单限制
"""

import os
import sys
import platform
import subprocess
import webbrowser
import urllib.parse

# ========== 安全配置 ==========

# 应用启动白名单（名称 → 可执行文件/命令）
APP_WHITELIST = {
    'notepad': 'notepad.exe',
    'code': 'code',
    'explorer': 'explorer.exe',
    'chrome': 'chrome',
    'edge': 'msedge',
    'firefox': 'firefox',
    'calc': 'calc.exe',
}


# ========== 工具函数 ==========


def open_app(app_name: str) -> dict:
    """
    打开应用程序（白名单限制）
    :param app_name: 应用名称，如 'notepad', 'code', 'chrome'
    :return: {app_name: str, pid: int}
    """
    if not app_name or not isinstance(app_name, str):
        raise ValueError('应用名称不能为空')

    app_key = app_name.lower().strip()
    if app_key not in APP_WHITELIST:
        allowed = ', '.join(sorted(APP_WHITELIST.keys()))
        raise PermissionError(f'应用 "{app_name}" 不在白名单中，允许的应用: {allowed}')

    command = APP_WHITELIST[app_key]

    try:
        # Windows 下使用 start 命令启动，避免阻塞
        if sys.platform == 'win32':
            proc = subprocess.Popen(
                ['cmd', '/c', 'start', '', command],
                shell=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return {'app_name': app_name, 'pid': proc.pid}
        else:
            proc = subprocess.Popen(
                [command],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return {'app_name': app_name, 'pid': proc.pid}
    except FileNotFoundError:
        raise FileNotFoundError(f'应用程序未找到: {command}')
    except Exception as e:
        raise RuntimeError(f'启动应用失败: {e}')


def open_url(url: str) -> dict:
    """
    在浏览器中打开 URL（仅允许 HTTPS）
    :param url: 要打开的 URL
    :return: {url: str}
    """
    if not url or not isinstance(url, str):
        raise ValueError('URL 不能为空')

    url = url.strip()

    # 解析 URL
    parsed = urllib.parse.urlparse(url)

    # 只允许 https
    if parsed.scheme not in ('https',):
        raise PermissionError(f'只允许 HTTPS 协议，当前: {parsed.scheme or "无协议"}')

    # 禁止访问内网地址
    hostname = parsed.hostname or ''
    blocked_hosts = ['localhost', '127.0.0.1', '0.0.0.0']
    if hostname in blocked_hosts:
        raise PermissionError(f'禁止访问内网地址: {hostname}')

    # 检查内网 IP 段
    if hostname.startswith('10.') or hostname.startswith('192.168.'):
        raise PermissionError(f'禁止访问内网地址: {hostname}')
    # 172.16.0.0 - 172.31.255.255
    if hostname.startswith('172.'):
        parts = hostname.split('.')
        if len(parts) >= 2:
            try:
                second = int(parts[1])
                if 16 <= second <= 31:
                    raise PermissionError(f'禁止访问内网地址: {hostname}')
            except ValueError:
                pass

    webbrowser.open(url)
    return {'url': url}


def get_system_info() -> dict:
    """
    获取系统信息
    :return: {os, hostname, username, cpu_count, memory_total_gb, disk_info}
    """
    import shutil

    # 基本信息
    info = {
        'os': f'{platform.system()} {platform.release()} ({platform.version()})',
        'hostname': platform.node(),
        'username': os.getlogin() if hasattr(os, 'getlogin') else os.environ.get('USERNAME', 'unknown'),
        'cpu_count': os.cpu_count() or 0,
        'memory_total_gb': 0,
        'disk_info': [],
    }

    # 内存信息（Windows）
    try:
        if sys.platform == 'win32':
            import ctypes
            kernel32 = ctypes.windll.kernel32
            c_ulonglong = ctypes.c_ulonglong

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ('dwLength', ctypes.c_ulong),
                    ('dwMemoryLoad', ctypes.c_ulong),
                    ('ullTotalPhys', c_ulonglong),
                    ('ullAvailPhys', c_ulonglong),
                    ('ullTotalPageFile', c_ulonglong),
                    ('ullAvailPageFile', c_ulonglong),
                    ('ullTotalVirtual', c_ulonglong),
                    ('ullAvailVirtual', c_ulonglong),
                    ('ullAvailExtendedVirtual', c_ulonglong),
                ]

            mem = MEMORYSTATUSEX()
            mem.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            kernel32.GlobalMemoryStatusEx(ctypes.byref(mem))
            info['memory_total_gb'] = round(mem.ullTotalPhys / (1024 ** 3), 2)
    except Exception:
        pass

    # 磁盘信息
    try:
        if sys.platform == 'win32':
            # 获取所有磁盘驱动器
            import string
            for letter in string.ascii_uppercase:
                drive = f'{letter}:\\'
                try:
                    usage = shutil.disk_usage(drive)
                    info['disk_info'].append({
                        'drive': drive,
                        'total_gb': round(usage.total / (1024 ** 3), 2),
                        'free_gb': round(usage.free / (1024 ** 3), 2),
                        'used_percent': round((usage.used / usage.total) * 100, 1),
                    })
                except (FileNotFoundError, PermissionError, OSError):
                    pass
        else:
            usage = shutil.disk_usage('/')
            info['disk_info'].append({
                'drive': '/',
                'total_gb': round(usage.total / (1024 ** 3), 2),
                'free_gb': round(usage.free / (1024 ** 3), 2),
                'used_percent': round((usage.used / usage.total) * 100, 1),
            })
    except Exception:
        pass

    return info


def set_clipboard(text: str) -> dict:
    """
    设置剪贴板文本（只写不读，保护隐私）
    :param text: 要写入剪贴板的文本
    :return: {length: int}
    """
    if text is None:
        raise ValueError('文本内容不能为空')

    text = str(text)

    try:
        if sys.platform == 'win32':
            # 使用 Windows API
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32

            CF_UNICODETEXT = 13
            GMEM_MOVEABLE = 0x0002

            # 打开剪贴板
            if not user32.OpenClipboard(None):
                raise RuntimeError('无法打开剪贴板')

            try:
                user32.EmptyClipboard()

                # 分配内存
                data = text.encode('utf-16-le') + b'\x00\x00'
                h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
                if not h_mem:
                    raise RuntimeError('内存分配失败')

                # 锁定内存并写入
                p_mem = kernel32.GlobalLock(h_mem)
                ctypes.memmove(p_mem, data, len(data))
                kernel32.GlobalUnlock(h_mem)

                # 设置剪贴板
                user32.SetClipboardData(CF_UNICODETEXT, h_mem)
            finally:
                user32.CloseClipboard()
        else:
            # 非 Windows 系统回退到 subprocess
            proc = subprocess.Popen(
                ['xclip', '-selection', 'clipboard'],
                stdin=subprocess.PIPE
            )
            proc.communicate(text.encode('utf-8'))

        return {'length': len(text)}
    except Exception as e:
        raise RuntimeError(f'设置剪贴板失败: {e}')
