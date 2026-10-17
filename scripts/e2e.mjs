/**
 * 端到端验证脚本：用 Edge 驱动真实页面，覆盖验收清单里的关键路径。
 * 用法：node scripts/e2e.mjs [--live]
 *   --live 时跑真实生成（需要 Agnes 队列可用）
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const URL = process.env.APP_URL ?? 'http://127.0.0.1:5178/'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SHOT = '.shot'
mkdirSync(SHOT, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-first-run', '--disable-gpu', '--window-size=1280,1000'],
  defaultViewport: { width: 1280, height: 1000 },
})

try {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

  await page.goto(URL, { waitUntil: 'networkidle2' })

  // 1. 页面与 Key
  const title = await page.title()
  const bodyText = await page.$eval('body', (el) => el.innerText)
  check('页面加载且标题正确', title === 'Agnes Video Studio', title)
  check('预置 API Key 已生效', /Key sk-/.test(bodyText), bodyText.match(/Key [^\n]*/)?.[0] ?? '')
  check('历史记录区为空态文案', bodyText.includes('还没有生成记录'))

  // 2. 空提示词时按钮禁用
  const btnDisabled = await page.$eval('button.btn--primary', (b) => b.disabled)
  check('空提示词时「开始生成」禁用', btnDisabled === true)

  // 3. 画幅切换
  await page.click('.chip:nth-child(5)') // 3:4 竖版
  const onChip = await page.$eval('.chip--on', (el) => el.textContent)
  check('画幅可切换', /3:4/.test(onChip ?? ''), onChip ?? '')

  // 4. 时长滑杆
  await page.$eval('input[type=range]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '8')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const secLabel = await page.$$eval('.field__label em', (els) => els.map((e) => e.textContent).join('|'))
  check('时长可调到 8 秒', secLabel.includes('8 秒'), secLabel)

  // 5. 填入示例并提交
  await page.click('.linkbtn')
  const promptLen = await page.$eval('.field__textarea', (el) => el.value.length)
  check('示例提示词已填入', promptLen > 10, `${promptLen} 字符`)
  const btnEnabled = await page.$eval('button.btn--primary', (b) => !b.disabled)
  check('有提示词后按钮可用', btnEnabled === true)

  // 6. 设置面板
  await page.screenshot({ path: `${SHOT}/01-ready.png` })
  await page.click('.topbar__right .btn')
  const modalOpen = (await page.$('.modal')) !== null
  check('设置面板可打开', modalOpen)
  await page.screenshot({ path: `${SHOT}/02-settings.png` })
  await page.click('.banner__close')
  await sleep(150)

  // 7. 用无效 Key 验证 401 路径（覆盖真实错误处理）
  await page.evaluate(() => {
    window.localStorage.setItem('agnes.config.apiKey', 'sk-invalid-key-for-test')
  })
  await page.reload({ waitUntil: 'networkidle2' })
  await page.click('.linkbtn')
  await page.click('button.btn--primary')
  await page.waitForSelector('.banner', { timeout: 30000 })
  const bannerText = await page.$eval('.banner', (el) => el.innerText)
  check('无效 Key 触发 401 中文提示', /API Key/.test(bannerText), bannerText.split('\n')[0])
  const hasTech = await page.$$eval('.linkbtn', (els) => els.some((e) => e.textContent?.includes('技术详情')))
  check('401 提供技术详情展开', hasTech)
  // 展开技术详情，确认保留服务端原文
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.linkbtn'))
    const b = btns.find((x) => x.textContent?.includes('技术详情'))
    b?.click()
  })
  await sleep(200)
  const rawShown = (await page.$('.banner__raw')) !== null
  check('技术详情显示服务端原文', rawShown)
  await page.screenshot({ path: `${SHOT}/03-401.png` })

  // 8. 历史记录持久化
  const cardCount = await page.$$eval('.card', (els) => els.length)
  check('创建失败的记录写入历史', cardCount >= 1, `${cardCount} 条`)
  await page.reload({ waitUntil: 'networkidle2' })
  const cardCount2 = await page.$$eval('.card', (els) => els.length)
  check('刷新后历史记录仍在', cardCount2 === cardCount, `${cardCount2} 条`)

  // 9. 恢复预置 Key
  await page.evaluate(() => window.localStorage.removeItem('agnes.config.apiKey'))
  await page.reload({ waitUntil: 'networkidle2' })
  const restored = await page.$eval('body', (el) => /Key sk-/.test(el.innerText))
  check('清除覆盖值后回落到预置 Key', restored)

  // 10. 控制台无报错（401/503 是刻意构造的失败请求，浏览器必然记一条资源日志，排除）
  const realErrors = consoleErrors.filter(
    (e) => !/Failed to load resource/.test(e) && !/status of (401|429|503)/.test(e),
  )
  check('无未捕获的页面异常', realErrors.length === 0, realErrors.slice(0, 2).join(' | ') || '无')

  // 11. 可选：真实生成
  if (process.argv.includes('--live')) {
    console.log('\n--- 真实生成（可能受队列拥塞影响）---')
    await page.click('.linkbtn')
    await page.click('button.btn--primary')
    const deadline = Date.now() + 15 * 60 * 1000
    let sawProgress = false
    while (Date.now() < deadline) {
      await sleep(3000)
      const t = await page.$eval('body', (el) => el.innerText)
      if (/生成中|正在生成/.test(t)) sawProgress = true
      if (await page.$('video.preview__video')) break
      if (/服务端生成队列已满|免费额度触发限流/.test(t)) {
        console.log('  队列拥塞，等待自动重试…')
      }
    }
    check('出现生成进度', sawProgress)
    const video = await page.$('video.preview__video')
    check('成片可在页面内播放', video !== null)
    if (video) {
      const src = await video.evaluate((v) => v.src)
      check('成片地址有效', src.startsWith('http'), src.slice(0, 60))
      await page.screenshot({ path: `${SHOT}/04-completed.png` })
    }
  }
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
