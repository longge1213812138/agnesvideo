/**
 * 一键运行全部前端验证（不需要 Agnes 队列可用）。
 * 用法：node scripts/verify-all.mjs
 * 前置：本地服务已在 APP_URL（默认 http://127.0.0.1:5178/）运行。
 */
import { spawn } from 'node:child_process'

const SUITES = [
  ['基础界面与错误处理', 'scripts/e2e.mjs'],
  ['故障注入（断网/503/失败/429）', 'scripts/e2e-faults.mjs'],
  ['真实响应样本解析', 'scripts/e2e-samples.mjs'],
  ['下载成片链路', 'scripts/e2e-download.mjs'],
  ['并发上限', 'scripts/e2e-concurrency.mjs'],
  ['刷新恢复', 'scripts/e2e-resume.mjs'],
]

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

let failedSuites = 0
for (const [label, file] of SUITES) {
  console.log(`\n${'='.repeat(58)}\n▶ ${label}（${file}）\n${'='.repeat(58)}`)
  const code = await run(file)
  if (code !== 0) failedSuites += 1
}

console.log(`\n${'='.repeat(58)}`)
console.log(failedSuites === 0 ? `全部 ${SUITES.length} 个套件通过` : `${failedSuites} 个套件失败`)
console.log('='.repeat(58))
process.exit(failedSuites === 0 ? 0 : 1)
