// Durable account tombstones make revocation immediate across regions and devices.
// KV alone can return an old password record after an administrator deletes an account.
const scoped = new WeakSet();
// Memoize only within one HTTP request, including its internal native bridge.
const checks = new WeakMap();
export async function accountDeleted(env, id) {
  if (!id || !env.NATIVE_ACCOUNTS) return false;
  const memo=checks.get(env);if(memo?.has(id))return memo.get(id);
  const check=(async()=>{
  const response = await env.NATIVE_ACCOUNTS.get(env.NATIVE_ACCOUNTS.idFromName('account:' + id)).fetch(new Request('https://native-account.internal/access', {method:'GET'}));
  if (!response.ok) throw Object.assign(new Error('账号状态暂不可用，请稍后重试'), {status:503});
  const status = await response.json();
  return status.deleted === true;
  })();
  if(memo)memo.set(id,check);
  return check;
}
export function accountAccessEnvironment(env) {
  if (scoped.has(env) || !env.NATIVE_ACCOUNTS || !env.MEMORY_KV) return env;
  const original = env.MEMORY_KV;
  let result;
  const kv = new Proxy(original, {get(target, field) {
    if (field === 'get') return async function(key, ...args) {
      if (typeof key === 'string' && key.startsWith('user:') && await accountDeleted(result, key.slice(5))) return null;
      return original.get(key, ...args);
    };
    const value = Reflect.get(target, field, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  result = {...env, MEMORY_KV:kv};
  checks.set(result,new Map());
  scoped.add(result);
  return result;
}
