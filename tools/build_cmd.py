"""把 tools/*.cmd.tpl 编译成可执行的 *.cmd

设计约束：生成的 .cmd 必须是**纯 ASCII**。
cmd.exe 按 ANSI 代码页解析批处理文件，任何非 ASCII 字符都可能
破坏执行流（乱码、命令被截断、跳转失效）。因此这里不只是转码，
还会在发现非 ASCII 字符时直接报错，避免问题带到运行时。

源文件：tools/*.cmd.tpl（UTF-8/ASCII）
产物：  <root>/*.cmd（ASCII + CRLF）

用法:
    python tools/build_cmd.py          # 构建
    python tools/build_cmd.py --check  # 只校验 ASCII，不写文件
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL_DIR = os.path.join(ROOT, 'tools')
CHECK_ONLY = '--check' in sys.argv


def find_non_ascii(text):
    """返回 [(行号, 列号, 字符, 上下文)]，空列表表示纯 ASCII"""
    bad = []
    for lineno, line in enumerate(text.split('\n'), 1):
        for col, ch in enumerate(line, 1):
            if ord(ch) > 127:
                ctx = line.strip()[:60]
                bad.append((lineno, col, ch, ctx))
    return bad


def main():
    if not os.path.isdir(TPL_DIR):
        print('[X] tools/ not found')
        return 1

    tpls = sorted(f for f in os.listdir(TPL_DIR) if f.endswith('.cmd.tpl'))
    if not tpls:
        print('[skip] no .cmd.tpl files in tools/')
        return 0

    failed = False
    for tpl in tpls:
        src = os.path.join(TPL_DIR, tpl)
        with open(src, 'r', encoding='utf-8') as f:
            text = f.read()

        bad = find_non_ascii(text)
        if bad:
            failed = True
            print('[X] %s contains non-ASCII characters:' % tpl)
            for lineno, col, ch, ctx in bad[:20]:
                print('    line %d, col %d: %r  |  %s' % (lineno, col, ch, ctx))
            if len(bad) > 20:
                print('    ... and %d more' % (len(bad) - 20))
            print('    .cmd files must be ASCII-only. Fix the template.')
            continue

        if CHECK_ONLY:
            print('[ok] %s is ASCII-only (%d lines)' % (tpl, text.count('\n') + 1))
            continue

        # ASCII 编码到任意代码页都一致，直接规范化换行即可
        out = text.replace('\r\n', '\n').replace('\n', '\r\n')
        dst = os.path.join(ROOT, tpl[:-4])  # 去掉 .tpl
        with open(dst, 'wb') as f:
            f.write(out.encode('ascii'))

        print('[ok] %s -> %s (%d bytes, ASCII/CRLF)'
              % (tpl, os.path.basename(dst), len(out.encode('ascii'))))

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
