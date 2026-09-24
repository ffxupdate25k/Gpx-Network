import { CONFIG } from "./web-config.js";
import { tg } from "./web-telegram.js";
const authHeader = () => ({ Authorization: "tma " + tg.initData });
async function http(path, method="GET", body) {
  let res;
  try { res = await fetch(CONFIG.API_BASE + path, { method, headers:{"Content-Type":"application/json", ...authHeader()}, body: body!==undefined?JSON.stringify(body):undefined }); }
  catch(e){ throw new Error("No connection. Check your internet and try again."); }
  const data=await res.json().catch(()=>({}));
  if(!res.ok){ const err=new Error(data.error||"Request failed ("+res.status+")"); err.status=res.status; err.gate=!!data.gate; throw err; }
  return data;
}
const post=(p,b)=>http(p,"POST",b===undefined?{}:b);
export const api={
 support:(message)=>post('/api/support',{message}),
 getGate:()=>http("/api/gate"), getMe:()=>http("/api/me"), getHistory:()=>http("/api/history"), getReferrals:()=>http("/api/referrals"), getTasks:()=>http("/api/tasks"),
 getLeaderboard:()=>http("/api/leaderboard"), getPromoCodes:()=>http("/api/promo-codes"), redeemPromo:(code)=>post("/api/promo-codes/redeem",{code}),
 claimTask:(id)=>post(`/api/tasks/${id}/claim`), startTask:(id)=>post(`/api/tasks/${id}/start`),
 convert:(amount)=>post("/api/convert",{amount}),
 requestWithdrawal:(payload)=>post("/api/withdrawals",payload), saveWallet:(address)=>post("/api/wallet",{address}), getWithdrawalStatus:(id)=>http(`/api/withdrawals/${id}/status`),
 generateGpxWallet:()=>post("/api/gpx-wallet/generate"), revokeGpxWallet:()=>post("/api/gpx-wallet/revoke"),
 transferRecipient:(address)=>http(`/api/onchain/recipient?address=${encodeURIComponent(address)}`),
 getSecurity:()=>http('/api/security'), setPin:(pin,current_pin)=>post('/api/security/pin',{pin,current_pin}), verifyPin:(pin)=>post('/api/security/verify-pin',{pin}),
 registerBiometric:(token,pin)=>post('/api/security/biometric/register',{token,pin}), verifyBiometric:(token)=>post('/api/security/biometric/verify',{token}),
 transferGpx:(address,amount,security)=>post("/api/onchain/transfer",{address,amount,security}),
 ads:{status:()=>http("/api/ads/status"),start:()=>post("/api/ads/start"),reward:(nonce)=>post("/api/ads/reward",{nonce})},
 setNotifications:(enabled)=>post("/api/notifications",{enabled}),
 admin:{
  overview:()=>http("/api/admin/overview"), getSettings:()=>http("/api/admin/settings"), saveSettings:(s)=>http("/api/admin/settings","PUT",s),
  channels:()=>http("/api/admin/channels"), createChannel:(c)=>post("/api/admin/channels",c), updateChannel:(id,c)=>http(`/api/admin/channels/${id}`,"PUT",c), deleteChannel:(id)=>http(`/api/admin/channels/${id}`,"DELETE"),
  tasks:()=>http("/api/admin/tasks"), createTask:(t)=>post("/api/admin/tasks",t), updateTask:(id,t)=>http(`/api/admin/tasks/${id}`,"PUT",t), reorderTasks:(ids)=>post("/api/admin/tasks/reorder",{ids}), deleteTask:(id)=>http(`/api/admin/tasks/${id}`,"DELETE"),
  withdrawals:(status)=>http(`/api/admin/withdrawals?status=${encodeURIComponent(status)}`), sendWithdrawal:(id)=>post(`/api/admin/withdrawals/${id}/send`), approveWithdrawal:(id)=>post(`/api/admin/withdrawals/${id}/approve`), payWithdrawal:(id)=>post(`/api/admin/withdrawals/${id}/paid`), rejectWithdrawal:(id)=>post(`/api/admin/withdrawals/${id}/reject`),
  promoCodes:()=>http("/api/admin/promo-codes"), createPromo:(x)=>post("/api/admin/promo-codes",x), deletePromo:(code)=>http(`/api/admin/promo-codes/${encodeURIComponent(code)}`,"DELETE"),
  users:(q)=>http(`/api/admin/users?q=${encodeURIComponent(q||"")}`), adjustBalance:(id,amount,note)=>post(`/api/admin/users/${id}/balance`,{amount,note}), setLevel:(id,level)=>post(`/api/admin/users/${id}/level`,{level}), banUser:(id,banned)=>post(`/api/admin/users/${id}/ban`,{banned}), resetWallet:(id)=>post(`/api/admin/users/${id}/wallet/reset`), admins:()=>http("/api/admin/admins"), addAdmin:(id)=>post("/api/admin/admins",{id}), removeAdmin:(id)=>post(`/api/admin/admins/${id}/remove`),
  broadcast:(payload)=>post("/api/admin/broadcast",payload), broadcasts:()=>http("/api/admin/broadcasts")
 }
};
