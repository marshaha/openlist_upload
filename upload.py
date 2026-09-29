#!/usr/bin/env python3
"""上传文件到 OpenList 并输出稳定直链(可嵌入 Markdown / 网页)。

用法:
    python3 upload.py --server https://alist.example.com <文件路径> [目标目录]

示例:
    python3 upload.py -s https://alist.example.com photo.jpg
    python3 upload.py -s https://alist.example.com photo.jpg /189Cloud/img

地址与凭据:
    --server / 环境变量 OPENLIST_BASE   OpenList 站点地址(二选一,必填)
    环境变量 OPENLIST_TOKEN             API 令牌(必填,避免出现在 shell 历史中)
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

DEFAULT_DIR = "/189Cloud/test"


def upload(base_url: str, token: str, local_path: str, remote_dir: str) -> str:
    filename = os.path.basename(local_path)
    remote_path = f"{remote_dir.rstrip('/')}/{filename}"
    # File-Path 头必须 URL 编码(整段路径,含斜杠)
    file_path_header = urllib.parse.quote(remote_path, safe="")

    with open(local_path, "rb") as f:
        data = f.read()

    req = urllib.request.Request(
        f"{base_url}/api/fs/put",
        data=data,
        method="PUT",
        headers={
            "Authorization": token,
            "File-Path": file_path_header,
            "Content-Type": "application/octet-stream",
            "As-Task": "false",
            # Cloudflare 会拦截 python-urllib 默认 UA
            "User-Agent": "curl/8.0",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    if result.get("code") != 200:
        raise RuntimeError(f"上传失败: {result}")

    # 稳定直链: /d/<路径> ,文件名需 URL 编码但保留斜杠
    direct_link = f"{base_url}/d{urllib.parse.quote(remote_path)}"
    return direct_link


IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}
AUDIO_EXT = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"}


def snippets(name: str, link: str) -> list[str]:
    stem, ext = os.path.splitext(name)
    ext = ext.lower()
    if ext in IMAGE_EXT:
        return [f"Markdown: ![{stem}]({link})", f'HTML: <img src="{link}" alt="{name}">']
    if ext in VIDEO_EXT:
        return [f"Markdown: [{name}]({link})", f'HTML: <video controls src="{link}"></video>']
    if ext in AUDIO_EXT:
        return [f"Markdown: [{name}]({link})", f'HTML: <audio controls src="{link}"></audio>']
    return [f"Markdown: [{name}]({link})"]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="上传文件到 OpenList 并输出稳定直链(可嵌入 Markdown / 网页)"
    )
    parser.add_argument("file", help="本地文件路径")
    parser.add_argument(
        "remote_dir",
        nargs="?",
        default=DEFAULT_DIR,
        help=f"远程目录(默认 {DEFAULT_DIR})",
    )
    parser.add_argument(
        "-s",
        "--server",
        default=os.environ.get("OPENLIST_BASE", ""),
        help="OpenList 站点地址,也可用环境变量 OPENLIST_BASE",
    )
    args = parser.parse_args()

    if not args.server:
        parser.error("请通过 --server 或环境变量 OPENLIST_BASE 提供站点地址")
    token = os.environ.get("OPENLIST_TOKEN", "")
    if not token:
        parser.error("请通过环境变量 OPENLIST_TOKEN 提供 API 令牌")

    base_url = args.server.rstrip("/")
    link = upload(base_url, token, args.file, args.remote_dir)
    name = os.path.basename(args.file)
    print(f"直链: {link}")
    for line in snippets(name, link):
        print(line)


if __name__ == "__main__":
    main()
