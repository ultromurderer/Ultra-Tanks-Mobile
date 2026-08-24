(()=>{
  'use strict';
  const coarse = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window) || navigator.maxTouchPoints>0;
  const forced = new URLSearchParams(location.search).get('mobile') === '1';
  if(!coarse && !forced) return;

  document.body.classList.add('ut-mobile');
  window.UT_MOBILE = true;
  const held = new Set();
  const controls = document.getElementById('mobileControls');
  const splash = document.getElementById('splash');
  const difficulty = document.getElementById('difficultyOverlay');
  const nickname = document.getElementById('nicknameOverlay');
  const lobby = document.getElementById('lobbyOverlay');
  const side = document.querySelector('.side');
  const menuToggle = document.getElementById('mobileMenuToggle');
  const menuClose = document.getElementById('mobileMenuClose');
  const canvas = document.getElementById('game');
  const baseCanvas = document.getElementById('baseCanvas');

  const fireKeyboard=(type,code)=>{
    const e=new KeyboardEvent(type,{code,key:code,bubbles:true,cancelable:true});
    window.dispatchEvent(e);
  };
  const holdDown=(code,btn)=>{
    if(!code || held.has(code)) return;
    held.add(code);btn?.classList.add('is-down');fireKeyboard('keydown',code);
  };
  const holdUp=(code,btn)=>{
    if(!code) return;
    held.delete(code);btn?.classList.remove('is-down');fireKeyboard('keyup',code);
  };
  const tap=(code,btn)=>{
    if(!code) return;
    btn?.classList.add('is-down');
    fireKeyboard('keydown',code);
    setTimeout(()=>{fireKeyboard('keyup',code);btn?.classList.remove('is-down');},70);
  };
  const bindHold=btn=>{
    const code=btn.dataset.holdKey;
    const down=e=>{e.preventDefault();try{btn.setPointerCapture?.(e.pointerId);}catch(_){}holdDown(code,btn);};
    const up=e=>{e.preventDefault();holdUp(code,btn);};
    btn.addEventListener('pointerdown',down,{passive:false});
    btn.addEventListener('pointerup',up,{passive:false});
    btn.addEventListener('pointercancel',up,{passive:false});
    btn.addEventListener('lostpointercapture',()=>holdUp(code,btn));
  };
  const bindTap=btn=>btn.addEventListener('pointerdown',e=>{e.preventDefault();tap(btn.dataset.tapKey,btn);},{passive:false});

  controls?.querySelectorAll('[data-hold-key]').forEach(bindHold);
  controls?.querySelectorAll('[data-tap-key]').forEach(bindTap);

  const closeMenu=()=>document.body.classList.remove('mobile-menu-open');
  menuToggle?.addEventListener('click',e=>{e.preventDefault();document.body.classList.toggle('mobile-menu-open');});
  menuClose?.addEventListener('click',e=>{e.preventDefault();closeMenu();canvas?.focus?.();});
  side?.addEventListener('click',e=>{
    if(e.target?.matches?.('.side-tab') && innerWidth<700) setTimeout(()=>{},0);
  });

  const releaseAll=()=>{
    for(const code of [...held]) fireKeyboard('keyup',code);
    held.clear();
    controls?.querySelectorAll('.is-down').forEach(el=>el.classList.remove('is-down'));
  };
  addEventListener('blur',releaseAll);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();});

  // Touch placement on the strategic base: a tap must establish the hovered cell before the click handler fires.
  if(baseCanvas){
    baseCanvas.addEventListener('pointerdown',e=>{
      if(e.pointerType==='touch'){
        try{baseCanvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:e.pointerId,pointerType:'touch',clientX:e.clientX,clientY:e.clientY,bubbles:true}));}catch(_){}
      }
    },{capture:true,passive:true});
  }

  // Prevent Safari double-tap zoom / page panning on the actual play surface.
  for(const el of [canvas,baseCanvas,controls]){
    if(!el) continue;
    el.addEventListener('touchmove',e=>{if(document.body.classList.contains('mobile-game-active'))e.preventDefault();},{passive:false});
  }

  const isHidden=el=>!el || el.classList.contains('hidden') || getComputedStyle(el).display==='none';

  const applyMobileLanguage=()=>{
    const en=document.documentElement.lang==='en';
    const set=(sel,ru,enText)=>{const el=document.querySelector(sel);if(el)el.textContent=en?enText:ru;};
    set('[data-tap-key="KeyR"]','ЗАНОВО','RESTART');
    set('[data-tap-key="KeyP"]','ПАУЗА','PAUSE');
    set('#mobileMenuToggle','МЕНЮ','MENU');
    const c=document.querySelector('[data-tap-key="KeyC"] small'); if(c)c.textContent=en?'SUPPLY':'СНАБ.';
    const v=document.querySelector('[data-tap-key="KeyV"] small'); if(v)v.textContent=en?'STRIKE':'РАКЕТА';
    document.querySelectorAll('.mobile-ability small').forEach(el=>el.textContent=en?'SKILL':'СПОС.');
    const rt=document.querySelector('#mobileRotate strong'); if(rt)rt.textContent=en?'ROTATE YOUR DEVICE':'ПОВЕРНИТЕ УСТРОЙСТВО';
    const rs=document.querySelector('#mobileRotate span'); if(rs)rs.textContent=en?'Ultra Tanks Mobile is designed for landscape mode.':'Ultra Tanks Mobile рассчитана на горизонтальный режим.';
  };
  new MutationObserver(applyMobileLanguage).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  applyMobileLanguage();

  const syncState=()=>{
    const splashGone=isHidden(splash);
    const blocking=![difficulty,nickname,lobby].every(isHidden);
    const active=splashGone && !blocking;
    document.body.classList.toggle('mobile-game-active',active);
    if(!active){closeMenu();releaseAll();}
  };
  const mo=new MutationObserver(syncState);
  [splash,difficulty,nickname,lobby].filter(Boolean).forEach(el=>mo.observe(el,{attributes:true,attributeFilter:['class','style']}));
  syncState();

  // On iOS this avoids lingering pressed-state after context gestures.
  document.addEventListener('contextmenu',e=>{
    if(e.target?.closest?.('.mobile-controls')) e.preventDefault();
  });
})();
