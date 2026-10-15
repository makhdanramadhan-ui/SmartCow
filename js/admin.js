// Admin screen: all writes use the primary authenticated session and RTDB Rules.
(function(){
  const el=id=>document.getElementById(id);
  let stop=null,epoch=0,busy=false;
  const allowed=()=>window.SCSAccess.can(window.smartcowAccess,'admin');
  const status=text=>{el('adminStatus').textContent=text;};
  const message=error=>error?.code==='auth/email-already-in-use'?'Email sudah terdaftar. Gunakan akun baru atau hubungi pemilik proyek untuk menambahkan izin akun lama.':
    error?.code==='auth/weak-password'?'Password terlalu lemah. Gunakan minimal 8 karakter.':error?.code==='auth/invalid-email'?'Alamat email tidak valid.':
    error?.code==='PERMISSION_DENIED'?'Izin Admin sudah tidak tersedia.':error?.message||'Tindakan gagal. Periksa koneksi lalu coba lagi.';
  function node(tag,text,className){const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;}
  function checkbox(label,checked){const wrap=node('label'),input=node('input');input.type='checkbox';input.checked=checked;wrap.append(input,document.createTextNode(label));return {wrap,input};}
  function render(users){
    const list=el('userList');list.replaceChildren();
    users.sort((a,b)=>(a.role==='admin'?-1:1)-(b.role==='admin'?-1:1)||String(a.email).localeCompare(String(b.email)));
    for(const user of users){
      const row=node('section',null,'user-row'),heading=node('div',null,'user-heading');
      heading.append(node('b',user.name||user.email),node('span',user.email,'hint'));row.append(heading);
      if(user.role==='admin'){row.append(node('p','Admin · seluruh izin Kandang A','hint'));list.append(row);continue;}
      const a=SCSAccess.normalize({...user,enabled:true}),options=node('fieldset',null,'permission-options');options.append(node('legend','Izin Kandang A'));
      const inputs={};
      for(const [key,label] of [['monitor','Monitoring'],['settings','Pengaturan'],['operate','Operasi sprinkler']]){
        const choice=checkbox(label,a.permissions[key]);inputs[key]=choice.input;options.append(choice.wrap);
        choice.input.onchange=()=>{if(key!=='monitor'&&choice.input.checked)inputs.monitor.checked=true;if(key==='monitor'&&!choice.input.checked){inputs.settings.checked=false;inputs.operate.checked=false;}};
      }
      const active=checkbox('Akses aktif',user.enabled===true),actions=node('div',null,'user-actions');
      const save=node('button','Simpan izin','btn blue small'),reset=node('button','Kirim email reset','btn small');save.type=reset.type='button';
      save.onclick=async()=>{
        if(!allowed()||busy)return;busy=true;save.disabled=true;
        try{await SCSFirebase.saveUser(user.uid,{email:user.email,name:user.name||'',enabled:active.input.checked,...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.checked]))});status('Izin akun tersimpan.');}
        catch(error){status(message(error));}finally{busy=false;if(save.isConnected)save.disabled=false;}
      };
      reset.onclick=async()=>{if(!allowed()||busy)return;busy=true;reset.disabled=true;try{await SCSFirebase.resetPassword(user.email);status('Email reset password dikirim. Periksa juga folder spam.');}catch(error){status(message(error));}finally{busy=false;if(reset.isConnected)reset.disabled=false;}};
      actions.append(active.wrap,save,reset);row.append(options,actions);list.append(row);
    }
    if(!users.length)list.append(node('p','Belum ada akun.','hint'));
  }
  window.SCSAdmin={sync(){
    const current=++epoch;stop?.();stop=null;el('userList').replaceChildren();el('newUserPassword').value='';status('');
    if(!allowed())return;
    status('Memuat akun…');
    try{stop=SCSFirebase.subscribeUsers(users=>{if(current!==epoch||!allowed())return;render(users);status('');},()=>{if(current===epoch){el('userList').replaceChildren();status('Daftar akun tidak dapat dimuat. Periksa koneksi.');}});}
    catch(error){status(message(error));}
  }};
  const newInputs=['newMonitor','newSettings','newOperate'].map(el);
  newInputs.forEach((input,i)=>input.onchange=()=>{if(i&&input.checked)newInputs[0].checked=true;if(!i&&!input.checked){newInputs[1].checked=false;newInputs[2].checked=false;}});
  el('createUserForm').onsubmit=async event=>{
    event.preventDefault();if(!allowed()||busy)return;
    const current=epoch,password=el('newUserPassword').value;
    if(password.length<8){status('Password minimal 8 karakter.');return;}
    const record={email:el('newUserEmail').value,name:el('newUserName').value,enabled:true,monitor:newInputs[0].checked,settings:newInputs[1].checked,operate:newInputs[2].checked};
    busy=true;el('btnCreateUser').disabled=true;el('newUserPassword').value='';status('Membuat akun…');
    try{await SCSFirebase.createUser(record,password);if(current===epoch&&allowed()){el('createUserForm').reset();status('Akun User dibuat. Sesi Admin tetap aktif.');}}
    catch(error){if(current===epoch&&allowed())status(message(error));}
    finally{busy=false;el('btnCreateUser').disabled=false;}
  };
  const profile=el('profileMenu'),button=el('profileBtn');
  function close(){profile.hidden=true;button.setAttribute('aria-expanded','false');}
  button.onclick=()=>{profile.hidden=!profile.hidden;button.setAttribute('aria-expanded',String(!profile.hidden));};
  el('profileAdmin').onclick=()=>{close();if(allowed())showPage('admin');};
  el('profileLogout').onclick=()=>{close();el('btnLogout').click();};
  document.addEventListener('click',event=>{if(!event.target.closest('.profile-wrap'))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!profile.hidden){close();button.focus();}});
  if(allowed())window.SCSAdmin.sync();
})();
