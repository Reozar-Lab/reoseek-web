export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }
    
    // ==========================================
    // 域一：reoseek.de5.net (网关)
    // ==========================================
    if (hostname === 'reoseek.de5.net') {
      // 1. 验证接入码接口
      if (url.pathname === '/api/auth' && request.method === 'POST') {
        try {
          const { code } = await request.json();
          if (code === env.ACCESS_CODE) {
            // 生成一个简单凭证（加盐标识），前端用这个代替真正的 API Key
            const token = btoa(code + "_reoseek_salt");
            return new Response(JSON.stringify({ success: true, token }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response(JSON.stringify({ error: '准入码错误' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (e) {
          return new Response('Bad Request', { status: 400 });
        }
      }
      
      // 2. 返回网关 HTML 页面
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(gatekeeperHTML.replace('CHAT_DOMAIN_PLACEHOLDER', env.CHAT_DOMAIN || 'https://chat.reoseek.de5.net'), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' }
        });
      }
      
      return new Response('Not Found', { status: 404 });
    }
    
    // ==========================================
    // 域二：chat.reoseek.de5.net (前端与 API 代理)
    // ==========================================
    if (hostname.includes('chat.')) {
      
      // 1. 拦截 API 请求，进行代理
      // 官方 Demo 会请求 /models 进行校验，请求 /anthropic/v1/... 进行对话和上传
      const isApiRequest = url.pathname === '/models' || url.pathname.startsWith('/anthropic/');
      
      if (isApiRequest) {
        // 提取前端带来的假 Token
        const authHeader = request.headers.get('Authorization') || '';
        const xApiKey = request.headers.get('x-api-key') || '';
        const token = xApiKey || authHeader.replace('Bearer ', '');
        
        // 验证是不是我们发出去的 Token（包含我们设定的盐值）
        if (!token.includes("_reoseek_salt")) {
          return new Response(JSON.stringify({ error: '未授权，请重新输入接入码' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        // 构建发给 DeepSeek 官方的请求
        const newHeaders = new Headers(request.headers);
        newHeaders.delete('x-api-key');
        newHeaders.delete('Authorization');
        
        // 注入真正的 DeepSeek API Key
        newHeaders.set('Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`);
        newHeaders.set('x-api-key', env.DEEPSEEK_API_KEY);
        
        // 拼接目标 URL（注意，如果官方 demo 写的是 /anthropic/v1/messages，官方接口可能本身就是这个路径）
        const targetUrl = `https://api.deepseek.com${url.pathname}${url.search}`;
        
        const proxyReq = new Request(targetUrl, {
          method: request.method,
          headers: newHeaders,
          body: request.body // 流式透传
        });
        
        try {
          const response = await fetch(proxyReq);
          // 返回官方响应给前端（包括 SSE 流）
          const newResponse = new Response(response.body, response);
          newResponse.headers.set('Access-Control-Allow-Origin', '*');
          return newResponse;
        } catch (error) {
          return new Response(JSON.stringify({ error: '代理请求失败' }), { status: 502 });
        }
      }
      
      // 2. 返回前端静态资源
      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get('Content-Type');
      
      // 3. 如果是 HTML 页面，注入脚本提取 URL 上的 Token
      if (contentType && contentType.includes('text/html')) {
        let html = await assetResponse.text();
        
        const injectScript = `
          <script>
            (function() {
              const urlParams = new URLSearchParams(window.location.search);
              const token = urlParams.get('token');
              if (token) {
                localStorage.setItem('reoseek_token', token);
                // 清理 URL 里的 token，防止被分享出去
                window.history.replaceState({}, document.title, window.location.pathname);
              }
            })();
          </script>
        `;
        
        // 把脚本注入到 <head> 中
        if (html.includes('</head>')) {
          html = html.replace('</head>', `${injectScript}</head>`);
        } else {
          html = injectScript + html;
        }
        
        const newHeaders = new Headers(assetResponse.headers);
        // 防止 HTML 被缓存，确保每次都能执行脚本
        newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        return new Response(html, { status: assetResponse.status, headers: newHeaders });
      }
      
      // 其他静态资源（JS、CSS、图片）直接透传
      return assetResponse;
    }
    
    return new Response("Not Found", { status: 404 });
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
                // 携带 Token 跳转到子域名
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