// Single-call probe: confirms the gateway handles UTF-8 and shows the response
// shape for each model before we spend a full experiment run on it.

const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const MODELS = ['deepseek/deepseek-v4-pro', 'codex/gpt-6.1-sol'];

for (const model of MODELS) {
  try {
    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '用中文回答两个字：收到' }],
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const json = await res.json();
    if (json.error) {
      console.log(`${model} -> ERROR ${json.error.message?.slice(0, 160)}`);
      continue;
    }
    const msg = json.choices?.[0]?.message ?? {};
    console.log(`${model} -> content=${JSON.stringify(msg.content)?.slice(0, 80)}`);
    if (msg.reasoning_content) {
      console.log(`    (has reasoning_content, ${msg.reasoning_content.length} chars)`);
    }
    console.log(`    keys: ${Object.keys(msg).join(', ')}`);
  } catch (e) {
    console.log(`${model} -> THREW ${e.message}`);
  }
}
