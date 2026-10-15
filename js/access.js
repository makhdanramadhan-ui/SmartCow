// Access records are authoritative only after Firebase Rules accepts them.
(function(root, factory){
  const api=factory();
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.SCSAccess=api;
})(typeof self!=='undefined'?self:globalThis,()=>{
  const permissions=['monitor','settings','operate'];
  function normalize(raw){
    const enabled=raw?.enabled===true, admin=enabled && raw?.role==='admin';
    const monitor=enabled && (admin || raw?.permissions?.monitor===true);
    return {enabled,role:admin?'admin':'user',email:typeof raw?.email==='string'?raw.email:'',
      name:typeof raw?.name==='string'?raw.name:'',permissions:{monitor,
        settings:monitor && (admin || raw?.permissions?.settings===true),
        operate:monitor && (admin || raw?.permissions?.operate===true)}};
  }
  function can(access, permission){
    const a=normalize(access);
    return permission==='admin' ? a.enabled && a.role==='admin' : permissions.includes(permission) && a.permissions[permission];
  }
  function userRecord({email,name='',enabled=true,monitor=false,settings=false,operate=false},now){
    return {email:email.trim().toLowerCase(),name:name.trim(),role:'user',enabled:enabled===true,
      permissions:{monitor:!!(monitor||settings||operate),settings:!!settings,operate:!!operate},updatedAt:now};
  }
  // Mode/manual outputs must never travel with a settings-only save.
  function settingsPayload(payload){
    const {mode,manualSsr,updatedAt,updatedBy,...settings}=payload;
    return settings;
  }
  return {normalize,can,userRecord,settingsPayload,permissions};
});
