export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 处理跨域预检 (万一前端需要跨域请求验证接口)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }

    // 1. 验证接入码接口
    if (url.pathname === '/api/auth' && request.method === 'POST') {
      try {
        const { code } = await request.json();
        if (code === env.ACCESS_CODE) {
          const token = btoa(code + "_reoseek_salt"); 
          return new Response(JSON.stringify({ success: true, token }), { 
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
          });
        }
        return new Response(JSON.stringify({ error: '准入码错误' }), { 
          status: 401, 
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
        });
      } catch (e) {
        return new Response('Bad Request', { status: 400 });
      }
    }

    // 2. 直接渲染网关 HTML（绝不走 env.ASSETS.fetch，防止跳 app.html）
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(gatekeeperHTML.replace('CHAT_DOMAIN_PLACEHOLDER', env.CHAT_DOMAIN), { 
        headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
      });
    }
    
    // 3. 其他路径一律 404
    return new Response('Not Found', { status: 404 });
  }
};

// 网关前端页面模板
const gatekeeperHTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reoseek · 访问验证</title>
    <style>
        body { background-color: #111; color: #f5d78d; font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .box { background: #1c1c1e; padding: 30px; border-radius: 20px; border: 1px solid #333; text-align: center; width: 300px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        h2 { margin-top: 0; letter-spacing: 0.1em; }
        input { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 1px solid #333; background: #000; color: #fff; margin: 20px 0; text-align: center; font-size: 16px; outline: none; }
        input:focus { border-color: #f5d78d; }
        button { width: 100%; padding: 12px; border-radius: 10px; border: none; background: linear-gradient(to right, #e8c88c, #c89f5d); color: #000; font-weight: bold; cursor: pointer; transition: 0.2s; }
        button:active { transform: scale(0.98); }
    </style>
</head>
<body>
    <div class="box">
        <h2>访问验证</h2>
        <p style="font-size: 12px; opacity: 0.6;">请输入站外接入码进入 Reoseek</p>
        <input type="password" id="code-input" placeholder="输入接入码">
        <button id="submit-btn">验证并进入</button>
    </div>
    <script>
        document.getElementById('submit-btn').addEventListener('click', async () => {
            const code = document.getElementById('code-input').value;
            if (!code) return;
            const btn = document.getElementById('submit-btn');
            btn.textContent = '验证中...';
            
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            
            if (res.ok) {
                const data = await res.json();
                // 彻底修正跳转逻辑
                window.location.href = 'CHAT_DOMAIN_PLACEHOLDER/?token=' + data.token;
            } else {
                alert('接入码错误');
                btn.textContent = '验证并进入';
            }
        });
    </script>
</body>
</html>
`;
