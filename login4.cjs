/** 真实登录：form-urlencoded（后端是 OAuth2PasswordRequestForm）→ 存 token。 */
const fs = require('fs');
const key = fs.readFileSync('D:/tmp/captcha-key.txt', 'utf8').trim();
const answer = process.argv[2];
(async () => {
  const body = new URLSearchParams({
    username: 'admin', password: '123456',
    captcha_key: key, captcha: answer, login_type: 'PC端',
  });
  const r = await fetch('https://www.pmdict.cn/api/v1/system/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json();
  if (j.code !== 0) { console.log('登录失败:', j.msg); process.exit(1); }
  const d = j.data ?? {};
  const at = d.access_token ?? d.accessToken ?? '';
  const rt = d.refresh_token ?? d.refreshToken ?? '';
  fs.writeFileSync('D:/tmp/token.txt', at);
  fs.writeFileSync('D:/tmp/refresh.txt', rt);
  console.log('登录成功，token 长度', at.length);
})();
