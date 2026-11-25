export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 处理跨域预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }
    
    // 2. 鉴权接口
    if (url.pathname === '/api/auth' && request.method === 'POST') {
      try {
        const { code } = await request.json();
        if (code === env.ACCESS_CODE) {
          // 签发一个简单的 Token（实际生产环境可以用加密JWT，这里为了简单直接用密码的Hash）
          const token = btoa(code + "salt");
          return new Response(JSON.stringify({ success: true, token }), {
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `reoseek_token=${token}; Path=/; HttpOnly; Secure; Max-Age=2592000` // 30天
            }
          });
        }
        return new Response(JSON.stringify({ error: '准入码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response('Bad Request', { status: 400 });
      }
    }
    
    // 3. 聊天代理接口 (对接官方 API)
    // 注意：由于我们会在 rspack 里配置 apiOrigin，这里假设前端请求的是 /chat/completions
    if (url.pathname === '/chat/completions' && request.method === 'POST') {
      // 校验 Cookie 或 Header
      const cookieHeader = request.headers.get('Cookie') || '';
      const tokenMatch = cookieHeader.match(/reoseek_token=([^;]+)/);
      if (!tokenMatch || !tokenMatch[1].includes(btoa(env.ACCESS_CODE).slice(0, 5))) {
        return new Response(JSON.stringify({ error: '未授权，请重新输入准入码' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      
      const originalBody = await request.json();
      
      // 构建发给 DeepSeek 官方的请求
      const targetUrl = 'https://api.deepseek.com/chat/completions';
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`);
      newHeaders.delete('Cookie'); // 不要把前端 Cookie 传给 DeepSeek
      
      const proxyReq = new Request(targetUrl, {
        method: 'POST',
        headers: newHeaders,
        body: JSON.stringify(originalBody)
      });
      
      // 发起流式请求
      const response = await fetch(proxyReq);
      
      // 如果不需要存数据库（比如前端配置了不保存），直接透传
      if (!response.ok) {
        return response;
      }
      
      // 4. 核心：流式拦截与 D1 入库
      const [stream1, stream2] = response.body.tee();
      
      // 后台异步处理入库，不阻塞前端流式输出
      ctx.waitUntil((async () => {
        try {
          const reader = stream2.getReader();
          const decoder = new TextDecoder();
          let fullContent = '';
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            // 提取流里的 content 文本
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                    fullContent += data.choices[0].delta.content;
                  }
                } catch (e) {}
              }
            }
          }
          
          // 流结束后，生成 session_id (这里简写，真实情况需前端传过来，或者根据首条消息生成)
          const sessionId = crypto.randomUUID();
          const userMsg = originalBody.messages[originalBody.messages.length - 1].content;
          
          // 写入用户消息
          await env.DB.prepare(`INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), sessionId, 'user', userMsg, Date.now()).run();
          // 写入 AI 回复
          await env.DB.prepare(`INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), sessionId, 'assistant', fullContent, Date.now()).run();
          // 写入会话记录 (如果是新会话)
          await env.DB.prepare(`INSERT INTO chat_sessions (id, user_token, title, created_at) VALUES (?, ?, ?, ?)`).bind(sessionId, btoa(env.ACCESS_CODE), userMsg.slice(0, 20), Date.now()).run();
          
        } catch (err) {
          console.error("D1 写入失败:", err);
        }
      })());
      
      // 将原始流（stream1）返回给前端
      return new Response(stream1, {
        status: response.status,
        headers: response.headers
      });
    }
    
    // 5. 获取历史记录接口
    if (url.pathname === '/api/sync' && request.method === 'GET') {
      try {
        const { results } = await env.DB.prepare(`
          SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT 100
        `).all();
        return new Response(JSON.stringify({ messages: results }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response('Database Error', { status: 500 });
      }
    }
    
    // 6. 兜底：返回静态资源 (官方 Demo 前端)
    return env.ASSETS.fetch(request);
  }
};