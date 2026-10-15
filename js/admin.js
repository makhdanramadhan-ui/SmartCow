// Account UI. Firebase Rules independently enforce role and target restrictions.
(function(){
  const el=id=>document.getElementById(id);
  let stop=null,epoch=0,busy=false,deleteResolve=null;
  const expanded=new Set();
  const allowed=()=>window.SCSAccess.can(window.smartcowAccess,'admin');
  const status=text=>{el('adminStatus').textContent=text;};
  const message=error=>error?.code==='auth/email-already-in-use'?'Email sudah terdaftar di Firebase Auth. Gunakan email lain atau hubungi pemilik proyek untuk mengelola akun lama.':
    error?.code==='auth/weak-password'?'Password terlalu lemah. Gunakan minimal 8 karakter.':error?.code==='auth/invalid-email'?'Alamat email tidak valid.':
    error?.code==='PERMISSION_DENIED'?'Tindakan ditolak. Periksa izin Admin dan jenis akun tujuan.':error?.message||'Tindakan gagal. Periksa koneksi lalu coba lagi.';
  function node(tag,text,className){const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;}
  function checkbox(label,checked,description){
    const wrap=node('label',null,description?'permission-choice':'access-toggle'),input=node('input');
    input.type='checkbox';input.checked=checked;input.setAttribute('aria-label',label);
    if(description){
      const copy=node('span',null,'permission-copy');
      copy.append(node('b',label),node('span',description));wrap.append(input,copy);
    }else wrap.append(input,node('span',label));
    return {wrap,input};
  }
  function initials(user){
    const name=String(user.name||user.email||'?').trim().split('@')[0],words=name.split(/\s+/).filter(Boolean);
    return (words.length>1?words[0][0]+words[words.length-1][0]:name.slice(0,2)).toLocaleUpperCase('id');
  }
  const deleteDialog=el('deleteUserDialog');
  deleteDialog.addEventListener('close',()=>{
    const resolve=deleteResolve;deleteResolve=null;resolve?.(deleteDialog.returnValue==='delete');
    el('deleteUserTarget').textContent='';
  });
  function confirmRemoval(user){
    if(deleteResolve)return Promise.resolve(false);
    el('deleteUserTarget').textContent=user.email;deleteDialog.returnValue='';deleteDialog.showModal();
    return new Promise(resolve=>{deleteResolve=resolve;});
  }
  function render(users){
    const list=el('userList');list.replaceChildren();el('userCount').textContent=`${users.length} akun`;
    for(const uid of expanded)if(!users.some(u=>u.uid===uid&&u.role==='user'))expanded.delete(uid);
    users.sort((a,b)=>(a.role==='admin'?-1:1)-(b.role==='admin'?-1:1)||String(a.email).localeCompare(String(b.email)));
    for(const [index,user] of users.entries()){
      const isAdmin=user.role==='admin',row=node('section',null,'user-row'),heading=node('div',null,'user-heading');
      row.setAttribute('aria-label',`Akun ${user.name||user.email}`);
      const avatar=node('span',initials(user),'user-avatar');avatar.setAttribute('aria-hidden','true');
      const identity=node('div',null,'user-identity'),title=node('div',null,'user-name');
      title.append(node('b',user.name||user.email),node('span',isAdmin?'Admin':'User','user-role'));
      identity.append(title,node('span',user.email,'user-email'));
      const state=node('span',user.enabled===true?'Aktif':'Nonaktif','user-state'+(user.enabled===true?' is-active':''));
      heading.append(avatar,identity,state);row.append(heading);
      if(isAdmin){row.classList.add('user-row-admin');row.append(node('span','Dikelola di Firebase Console','admin-owner-note'));list.append(row);continue;}
      const toggle=node('button','Tindakan','btn small account-actions-toggle');toggle.type='button';
      const panel=node('div',null,'user-management');panel.id=`account-actions-${index}`;panel.hidden=!expanded.has(user.uid);
      toggle.setAttribute('aria-controls',panel.id);toggle.setAttribute('aria-expanded',String(!panel.hidden));
      toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(panel.hidden)expanded.delete(user.uid);else expanded.add(user.uid);};
      heading.append(toggle);
      const a=SCSAccess.normalize({...user,enabled:true}),options=node('fieldset',null,'permission-options');options.append(node('legend','Izin Kandang A'));
      const inputs={};
      for(const [key,label,description] of [['monitor','Monitoring','Sensor & riwayat'],['settings','Pengaturan','Ambang & jadwal'],['operate','Operasi sprinkler','Mode & manual']]){
        const choice=checkbox(label,a.permissions[key],description);inputs[key]=choice.input;options.append(choice.wrap);
        choice.input.onchange=()=>{if(key!=='monitor'&&choice.input.checked)inputs.monitor.checked=true;if(key==='monitor'&&!choice.input.checked){inputs.settings.checked=false;inputs.operate.checked=false;}};
      }
      const active=checkbox('Akses aktif',user.enabled===true),actions=node('div',null,'user-actions'),buttons=node('div',null,'user-action-buttons');
      const save=node('button','Simpan perubahan','btn blue small'),remove=node('button','Hapus akun','btn red small');save.type=remove.type='button';
      const feedback=node('p',null,'user-feedback');feedback.setAttribute('role','status');
      save.onclick=async()=>{
        if(!allowed()||busy)return;const current=epoch;busy=true;save.disabled=true;
        try{await SCSFirebase.saveUser(user.uid,{email:user.email,name:user.name||'',enabled:active.input.checked,...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.checked]))});if(current===epoch&&allowed())status('Perubahan akun tersimpan.');}
        catch(error){if(current===epoch&&allowed()){status(message(error));feedback.textContent=message(error);}}
        finally{busy=false;if(save.isConnected)save.disabled=false;}
      };
      remove.onclick=async()=>{
        if(!allowed()||busy)return;const current=epoch;
        if(!await confirmRemoval(user)||current!==epoch||!allowed()||busy)return;
        busy=true;remove.disabled=true;
        try{await SCSFirebase.removeUserAccess(user.uid);if(current===epoch&&allowed()){expanded.delete(user.uid);status('Akun dihapus dari SmartCow. Identitas Firebase Auth tetap ada dan hanya dapat dihapus permanen melalui Firebase Console.');el('userListTitle').focus();}}
        catch(error){if(current===epoch&&allowed()){status(message(error));feedback.textContent=message(error);}}
        finally{busy=false;if(remove.isConnected)remove.disabled=false;}
      };
      buttons.append(remove,save);actions.append(active.wrap,buttons);
      panel.append(options,node('p','Perubahan izin dan akses berlaku setelah disimpan.','user-management-note'),actions,feedback);row.append(panel);list.append(row);
    }
    if(!users.length)list.append(node('p','Belum ada akun untuk ditampilkan.','admin-empty'));
  }
  window.SCSAdmin={sync(){
    const current=++epoch;stop?.();stop=null;expanded.clear();if(deleteDialog.open)deleteDialog.close('cancel');
    el('userList').replaceChildren();el('userCount').textContent='— akun';el('newUserPassword').value='';status('');
    if(!allowed())return;status('Memuat akun…');
    try{stop=SCSFirebase.subscribeUsers(users=>{if(current!==epoch||!allowed())return;render(users);if(el('adminStatus').textContent==='Memuat akun…')status('');},()=>{if(current===epoch){el('userList').replaceChildren();el('userCount').textContent='— akun';status('Daftar akun tidak dapat dimuat. Periksa koneksi.');}});}
    catch(error){status(message(error));}
  }};
  const newInputs=['newMonitor','newSettings','newOperate'].map(el);
  const selectedRole=()=>document.querySelector('input[name="newAccountRole"]:checked').value;
  function syncRole(){
    const admin=selectedRole()==='admin';el('newUserPermissions').hidden=admin;el('newUserPermissions').disabled=admin;
    el('newRoleHint').textContent=admin?'Admin mendapat seluruh izin kandang, dapat membuat akun dan mengelola User. Akun Admin hanya dikelola melalui Firebase Console.':'Pengaturan dan Operasi menyertakan Monitoring. Semua izin tidak menjadikan User sebagai Admin.';
  }
  document.querySelectorAll('input[name="newAccountRole"]').forEach(input=>input.onchange=syncRole);
  newInputs.forEach((input,i)=>input.onchange=()=>{if(i&&input.checked)newInputs[0].checked=true;if(!i&&!input.checked){newInputs[1].checked=false;newInputs[2].checked=false;}});
  el('createUserForm').onsubmit=async event=>{
    event.preventDefault();if(!allowed()||busy)return;
    const current=epoch,password=el('newUserPassword').value;
    if(password.length<8){status('Password minimal 8 karakter.');return;}
    const record={email:el('newUserEmail').value,name:el('newUserName').value,role:selectedRole(),enabled:true,monitor:newInputs[0].checked,settings:newInputs[1].checked,operate:newInputs[2].checked};
    busy=true;el('btnCreateUser').disabled=true;el('newUserPassword').value='';status('Membuat akun…');
    try{await SCSFirebase.createUser(record,password);if(current===epoch&&allowed()){el('createUserForm').reset();syncRole();status(`Akun ${record.role==='admin'?'Admin':'User'} dibuat. Sesi Admin tetap aktif.`);}}
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
  syncRole();if(allowed())window.SCSAdmin.sync();
})();
