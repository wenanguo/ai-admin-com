const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1600, height: 900 } });
  const p = await c.newPage();
  await p.addInitScript(([t]) => { localStorage.setItem('access_token', t); localStorage.setItem('refresh_token', t); localStorage.setItem('remember_me','true'); }, [process.env.TOKEN]);
  await p.goto('http://localhost:8000/pm/task/gantt');
  await p.waitForTimeout(5000);
  console.log('甘特页 URL:', p.url());
  const txt = await p.evaluate(() => document.body.innerText);
  console.log('甘特页正文:', JSON.stringify(txt.slice(0, 700)));
  await p.screenshot({ path: 'D:/tmp/gantt-now.png', fullPage: false });
  // 列表页的 CRUD 是否真坏
  await p.goto('http://localhost:8000/pm/task');
  await p.waitForTimeout(4000);
  console.log('列表行数:', await p.locator('.ant-table-tbody tr').count());
  await p.getByRole('button', { name: '新增' }).first().click();
  await p.waitForTimeout(3000);
  const modal = await p.evaluate(() => {
    const m = document.querySelector('.ant-modal');
    return m ? { visible: !!m.offsetParent, text: (m.innerText||'').slice(0,200), items: m.querySelectorAll('.ant-form-item').length } : null;
  });
  console.log('新增弹窗:', JSON.stringify(modal));
  await p.screenshot({ path: 'D:/tmp/list-modal.png' });
  await b.close();
})();
