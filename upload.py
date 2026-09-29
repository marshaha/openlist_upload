#!/usr/bin/env python3
"""上传文件到 OpenList 并输出稳定直链(可嵌入 Markdown / 网页)。

用法:
    python3 upload.py <文件路径> [目标目录]

示例:
    python3 upload.py photo.jpg                 # 上传到 /189Cloud/test/
    python3 upload.py photo.jpg /189Cloud/img   # 上传到 /189Cloud/img/

令牌可用环境变量 OPENLIST_TOKEN 覆盖。
"""

import os
import sys
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("OPENLIST_BASE", "https://alist.461922950.xyz")
TOKEN = os.environ.get("OPENLIST_TOKEN", "")
if not TOKEN:
    sys.exit("请通过环境变量 OPENLIST_TOKEN 提供 API 令牌")
DEFAULT_DIR = "/189Cloud/test"


def upload(local_path: str, remote_dir: str) -> str:
    filename = os.path.basename(local_path)
    remote_path = f"{remote_dir.rstrip('/')}/{filename}"
    # File-Path 头必须 URL 编码(整段路径,含斜杠)
    file_path_header = urllib.parse.quote(remote_path, safe="")

    with open(local_path, "rb") as f:
        data = f.read()

    req = urllib.request.Request(
        f"{BASE_URL}/api/fs/put",
        data=data,
        method="PUT",
        headers={
            "Authorization": TOKEN,
            "File-Path": file_path_header,
            "Content-Type": "application/octet-stream",
            "As-Task": "false",
            # Cloudflare 会拦截 python-urllib 默认 UA
            "User-Agent": "curl/8.0",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        import json

        result = json.loads(resp.read())
    if result.get("code") != 200:
        raise RuntimeError(f"上传失败: {result}")

    # 稳定直链: /d/<路径> ,文件名需 URL 编码但保留斜杠
    direct_link = f"{BASE_URL}/d{urllib.parse.quote(remote_path)}"
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
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    local = sys.argv[1]
    remote_dir = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_DIR

    link = upload(local, remote_dir)
    name = os.path.basename(local)
    print(f"直链: {link}")
    for line in snippets(name, link):
        print(line)


if __name__ == "__main__":
    main()
