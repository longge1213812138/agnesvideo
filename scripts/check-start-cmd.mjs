/**
 * 检查 start.cmd 的编码约束。
 *
 * cmd.exe 按系统代码页（中文 Windows 是 GBK）解析批处理文件，
 * 用 UTF-8 保存的中文会被拆成乱码命令。这个坑不会在开发时暴露，
 * 只会在用户双击时炸——所以用断言钉死。
 */
import { readFileSync } from 'node:fs'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const buf = readFileSync('start.cmd')

check('start.cmd 不含 BOM', !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf))
const nonAscii = [...buf].filter((b) => b > 127)
check('start.cmd 为纯 ASCII（避免 cmd.exe 代码页乱码）', nonAscii.length === 0, `${nonAscii.length} 个非 ASCII 字节`)

const text = buf.toString('ascii')
check('含 Node 缺失时的提示', /Node\.js not found/.test(text))
check('构建失败时暂停以便阅读', /Build failed/.test(text))
check('启动器异常时暂停', /Launcher exited unexpectedly/.test(text))
check('通过 launch.mjs 启动', /scripts\\launch\.mjs/.test(text))

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
