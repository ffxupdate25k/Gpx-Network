import{api}from"./web-api.js";import{getUser,getDisplayName,haptic,notify}from"./web-telegram.js";import{esc,avatarHTML,fail}from"./web-utils.js";import{bottom}from"./web-page-dashboard.js";import{pinSheet,biometricManager,bmInit,bmRequest,bmAuth}from"./web-security.js";
export default{async render(el,{go}){const me=await api.getMe(),u=getUser(),name=getDisplayName();let sec={has_pin:false,has_biometric:false};try{sec=await api.getSecurity();}catch(e){fail(e);}
 el.innerHTML=`<section class="page"><div class="top"><button class="page-back">‹</button><div class="top-copy"><h1>Profile</h1></div></div><div class="body"><div class="profilecard"><div class="avatar lg">${avatarHTML(u,name)}</div><div><b>@${esc(u.username||name)}</b><small>Level ${me.level}</small><div class="progress"><span style="width:${me.level_progress}%"></span></div></div><span class="verify">✓</span></div><div class="card listcard"><div>◉ <span>Telegram ID</span><b>${me.id}</b></div><div>◎ <span>Username</span><b>@${esc(u.username||"-")}</b></div><div>▣ <span>Joined</span><b>${new Date(me.created_at).toLocaleDateString()}</b></div></div><div class="card listcard"><h3>My Stats</h3><div>◉ <span>Total Earned</span><b>${Number(me.total_earned).toLocaleString()} GPX</b></div><div>♟ <span>Referrals</span><b>${me.referrals}</b></div><div>✓ <span>Tasks Completed</span><b>${me.tasks_completed}</b></div></div><div class="card"><button class="btn" id="history">📜 View History</button></div><div class="card listcard" id="securityCard"><h3>Security</h3><div>🔒 <span>Transaction PIN</span><button class="btn ghost sm" id="pinBtn">${sec.has_pin?"Change":"Set PIN"}</button></div><label>☝ <span>Biometric Login</span><input type="checkbox" id="bio" ${sec.has_biometric?"checked":""} ${sec.has_pin?"":"disabled"}></label>${sec.has_pin?"":'<div class="hint">Set a Transaction PIN first to enable biometrics.</div>'}<div class="hint">Your PIN (or biometrics, once turned on here) is required to confirm withdrawals and GPX transfers.</div></div><div class="card settings-list"><label>🔔 <span>Notifications</span><input type="checkbox" id="notif" ${me.notifications_enabled?"checked":""}></label><div>🌐 <span>Language</span><b>English</b></div><div>⌁ <span>Help & Support</span><b>›</b></div></div></div>${bottom("profile")}</section>`;
 el.querySelector("#history").onclick=()=>go("history");
 el.querySelector("#notif").onchange=async e=>{try{await api.setNotifications(e.target.checked);haptic("success");notify(e.target.checked?"Notifications enabled.":"Notifications disabled.")}catch(err){e.target.checked=!e.target.checked;fail(err)}};
 el.querySelector("#pinBtn").onclick=async()=>{
  if(!sec.has_pin){
   const made=await pinSheet(el,{title:"Set Transaction PIN",hint:"Create a 4-digit PIN. You will use it to authorize withdrawals and GPX transfers.",canUseBio:false,needSetup:true});
   if(!made)return;
   try{await api.setPin(made.pin,"");haptic("success");notify("Transaction PIN set.");this.render(el,{go});}catch(e){fail(e)}
  }else{
   const cur=await pinSheet(el,{title:"Current PIN",hint:"Enter your current 4-digit PIN.",canUseBio:false,needSetup:false});
   if(!cur)return;
   const made=await pinSheet(el,{title:"New PIN",hint:"Create your new 4-digit PIN.",canUseBio:false,needSetup:true});
   if(!made)return;
   try{await api.setPin(made.pin,cur.pin);haptic("success");notify("Transaction PIN updated.");}catch(e){fail(e)}
  }
 };
 el.querySelector("#bio").onchange=async e=>{
  const turnOn=e.target.checked;
  if(turnOn){
   const bm=await bmInit(biometricManager());
   if(!bm||!bm.isBiometricAvailable){e.target.checked=false;return notify("Biometrics are not available on this device.");}
   if(!bm.isAccessGranted){const ok=await bmRequest(bm,"Use biometrics to confirm GPX transfers and withdrawals.");if(!ok){e.target.checked=false;return notify("Biometric access was not granted.");}}
   const pinEntry=await pinSheet(el,{title:"Confirm PIN",hint:"Enter your Transaction PIN to enable biometrics.",canUseBio:false,needSetup:false});
   if(!pinEntry){e.target.checked=false;return;}
   const r=await bmAuth(bm,"Enable biometrics for GPX Network.");
   if(!(r.isAuthenticated&&r.biometricToken)){e.target.checked=false;return notify("Biometric verification failed.");}
   try{await api.registerBiometric(r.biometricToken,pinEntry.pin);haptic("success");notify("Biometrics enabled. You can now use them to confirm transfers and withdrawals.");sec.has_biometric=true;}catch(err){e.target.checked=false;fail(err);}
  }else{
   try{await api.revokeBiometric();notify("Biometrics disabled.");sec.has_biometric=false;}catch(err){e.target.checked=true;fail(err);}
  }
 };
}};
