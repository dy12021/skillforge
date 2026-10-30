#!/usr/bin/env python3
"""开源前脱敏扫描：0 命中才算干净。

用法：
    python scripts/scan_sensitive.py            # 扫描 git 将要提交的文件

只扫描「会被提交的文件」（git ls-files 减去 .gitignore 忽略项）。
被忽略的目录（.local/、storage/、node_modules/ 等）本就不进版本库，
但它们是本机私人数据，**绝不能靠 .gitignore 一道防线**——提交前用
`git status --ignored` 确认忽略规则没写漏。

退出码 0 = 干净；1 = 有命中（打印每条命中与位置）。
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# 明确允许出现的项：写在这里并说明理由，避免靠通配符放过一切。
ALLOWED = {
    # 本项目自带的本地开发库口令，只绑 127.0.0.1，且本来就在 .env.example 里。
    "skillforge_local",
    "skillforge_test",
    # 第三方依赖许可证里的上游作者邮箱（yaml 包的 MIT 许可证原文）。
    "eemeli@gmail.com",
    # GitHub noreply 身份。
    "dy12021@users.noreply.github.com",
}

TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".json", ".md", ".txt",
    ".yml", ".yaml", ".toml", ".ps1", ".sh", ".css", ".html", ".sql", ".env",
    ".example", ".gitignore", ".gitattributes", ".editorconfig", ".lock",
}

BINARY_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
    ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".wav",
}

RULES: list[tuple[str, str]] = [
    # 平台绝对路径：本机用户目录、项目目录、常见安装目录
    ("machine-path-windows", r"[A-Za-z]:[\\/](?:Users|coding|Program Files|ProgramData|Users\\)[^\s\"'`)\]]*"),
    ("machine-path-posix", r"/(?:Users|home)/[A-Za-z0-9._-]+[^\s\"'`)\]]*"),
    # 云盘/同步目录
    ("machine-path-cloud", r"[A-Za-z]:[\\/](?:OneDrive|Dropbox|Google Drive|BaiduNetdisk)[^\s\"'`)\]]*"),
    # 私钥与证书
    ("private-key", r"-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----"),
    ("private-key-armored", r"-----BEGIN CERTIFICATE-----"),
    # 常见令牌形态
    ("token-openai", r"\bsk-[A-Za-z0-9_-]{16,}"),
    ("token-github", r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}"),
    ("token-aws", r"\bAKIA[0-9A-Z]{16}\b"),
    ("token-slack", r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    ("token-google", r"\bAIza[0-9A-Za-z_-]{35}\b"),
    ("token-jwt", r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    # 凭据赋值：key 名后跟足够长的字面量
    ("credential-assignment", r"(?i)\b(?:api[_-]?key|apikey|secret[_-]?key|secret|password|passwd|passwd_hash|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*[\"']?([A-Za-z0-9_+/=\-]{12,})[\"']?"),
    # 连接串里带口令
    ("connection-string-password", r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s:@/]+:[^\s:@/]{6,}@"),
    # 身份证 / 手机号 / 银行卡
    ("id-card-cn", r"\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b"),
    ("phone-cn", r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    ("bank-card-cn", r"(?<!\d)\d{16,19}(?!\d)"),
]

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

# 这些文件天然包含大段第三方代码/许可证，逐行匹配误报高，单独处理。
GENERATED_PREFIXES = (
    "packages/core/generated/",
    ".agents/skills/skillforge/scripts/package-tools.mjs",
)


def git_files() -> list[Path]:
    args = ["git", "ls-files", "--cached", "--others", "--exclude-standard"]
    out = subprocess.run(args, cwd=REPO, capture_output=True, text=True, check=True)
    files = []
    for line in out.stdout.splitlines():
        line = line.strip()
        if line:
            files.append(REPO / line)
    return files


def is_scannable(path: Path) -> bool:
    name = path.name
    if name in {".env"}:
        return True
    suffix = path.suffix.lower()
    if suffix in BINARY_SUFFIXES:
        return False
    if suffix in TEXT_SUFFIXES:
        return True
    # 无扩展名的配置/锁文件（注意：pathlib 认为 .gitignore 这类点文件没有 suffix，
    # 必须按文件名判定，否则它们会被静默跳过扫描）
    return name in {
        "Dockerfile",
        "Makefile",
        "LICENSE",
        "Procfile",
        ".gitignore",
        ".gitattributes",
        ".editorconfig",
        ".npmrc",
        ".nvmrc",
    }


def scan_text(path: Path, text: str) -> list[str]:
    hits: list[str] = []
    rel = path.relative_to(REPO).as_posix()
    generated = rel.startswith(GENERATED_PREFIXES)
    for line_no, line in enumerate(text.splitlines(), start=1):
        for label, pattern in RULES:
            for match in re.finditer(pattern, line):
                found = match.group(0)
                if any(allowed in found for allowed in ALLOWED):
                    continue
                if generated and label in {
                    "credential-assignment",
                    "token-jwt",
                    "bank-card-cn",
                    "id-card-cn",
                    "phone-cn",
                }:
                    # 打包产物里的第三方压缩代码，数字常量会撞上身份证/银行卡形态
                    continue
                snippet = found if len(found) <= 90 else found[:90] + "…"
                hits.append(f"{rel}:{line_no}  [{label}]  {snippet}")
        for email in EMAIL_RE.findall(line):
            if email.lower() in {a.lower() for a in ALLOWED}:
                continue
            if generated:
                continue
            hits.append(f"{rel}:{line_no}  [email]  {email}")
    return hits


def main() -> int:
    files = git_files()
    hits: list[str] = []
    scanned = 0
    for path in files:
        if not path.is_file() or not is_scannable(path):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        hits.extend(scan_text(path, text))

    print(f"扫描文件 {scanned} 个 / 候选 {len(files)} 个")
    if hits:
        print(f"\n发现 {len(hits)} 处敏感命中：\n")
        for hit in hits:
            print("  " + hit)
        print("\n发布前必须清零。确认是误报时，把它写进 ALLOWED 并注明理由。")
        return 1
    print("未发现敏感信息，脱敏扫描通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
