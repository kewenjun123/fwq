/* ===== 识字小站 · 交互逻辑 ===== */
(function () {
  "use strict";

  const DATA = window.HANZI_DATA || [];
  const synth = window.speechSynthesis;
  const supportsTTS = !!synth;

  /* ---------- 扁平化字表 ---------- */
  const ALL = [];
  DATA.forEach(cat => {
    cat.chars.forEach(row => {
      ALL.push({
        char: row[0],
        pinyin: row[1],
        meaning: row[2],
        words: String(row[3] || "").split("|").filter(Boolean),
        catId: cat.id,
        catName: cat.name,
        catIcon: cat.icon
      });
    });
  });

  /* ---------- 状态 ---------- */
  const state = {
    cat: "all",
    query: "",
    list: ALL.slice(),
    rate: 0.8,
    voiceURI: "",
    night: false,
    playing: false,
    playToken: 0,
    current: null // 详情页当前字对象
  };

  const prefs = {
    load() {
      try {
        const raw = localStorage.getItem("hanzi-site-prefs");
        if (!raw) return;
        const p = JSON.parse(raw);
        if (typeof p.rate === "number") state.rate = p.rate;
        if (typeof p.voiceURI === "string") state.voiceURI = p.voiceURI;
        if (typeof p.night === "boolean") state.night = p.night;
      } catch (e) { /* 忽略损坏的本地配置 */ }
    },
    save() {
      try {
        localStorage.setItem("hanzi-site-prefs", JSON.stringify({
          rate: state.rate, voiceURI: state.voiceURI, night: state.night
        }));
      } catch (e) { /* 隐私模式下可能失败，忽略 */ }
    }
  };

  /* ---------- 元素 ---------- */
  const $ = id => document.getElementById(id);
  const grid = $("grid");
  const chipNav = $("categoryNav");
  const statusLine = $("statusLine");
  const emptyTip = $("emptyTip");
  const searchInput = $("searchInput");
  const clearSearch = $("clearSearch");
  const voiceSelect = $("voiceSelect");
  const rateRange = $("rateRange");
  const rateValue = $("rateValue");
  const themeBtn = $("themeBtn");
  const playAllBtn = $("playAllBtn");
  const stopBtn = $("stopBtn");
  const voiceWarn = $("voiceWarn");

  const detailMask = $("detailMask");
  const detailChar = $("detailChar");
  const detailPinyin = $("detailPinyin");
  const detailMeaning = $("detailMeaning");
  const detailTag = $("detailTag");
  const detailWords = $("detailWords");
  const detailSpeak = $("detailSpeak");
  const prevChar = $("prevChar");
  const nextChar = $("nextChar");
  const detailClose = $("detailClose");

  const quizMask = $("quizMask");
  const quizClose = $("quizClose");
  const quizPlay = $("quizPlay");
  const quizOptions = $("quizOptions");
  const quizFeedback = $("quizFeedback");
  const quizScoreEl = $("quizScore");
  const quizTotalEl = $("quizTotal");
  const quizNext = $("quizNext");
  const quizBtn = $("quizBtn");

  /* ---------- 语音 ---------- */
  let voices = [];

  function pickDefaultVoiceURI() {
    const zh = voices.filter(v => /^zh/i.test(v.lang));
    const pool = zh.length ? zh : voices;
    if (!pool.length) return "";
    const prefer = ["Xiaoxiao", "Microsoft Huihui", "Microsoft Yaoyao", "Google 普通话", "Tingting", "Meijia", "Sinji"];
    for (const name of prefer) {
      const hit = pool.find(v => v.name.includes(name));
      if (hit) return hit.voiceURI;
    }
    const cn = pool.find(v => /^zh[-_]CN/i.test(v.lang));
    return (cn || pool[0]).voiceURI;
  }

  function currentVoice() {
    if (!voices.length) return null;
    return voices.find(v => v.voiceURI === state.voiceURI) || voices.find(v => /^zh/i.test(v.lang)) || voices[0];
  }

  function refreshVoices() {
    if (!supportsTTS) return;
    voices = synth.getVoices() || [];
    const zh = voices.filter(v => /^zh/i.test(v.lang));

    // 填充分类下拉
    voiceSelect.innerHTML = "";
    if (!voices.length) {
      const o = document.createElement("option");
      o.textContent = "系统默认语音";
      o.value = "";
      voiceSelect.appendChild(o);
    } else {
      const groups = [
        ["中文普通话音色", zh],
        ["其他语言音色", voices.filter(v => !/^zh/i.test(v.lang))]
      ];
      groups.forEach(([label, list]) => {
        if (!list.length) return;
        const og = document.createElement("optgroup");
        og.label = label;
        list.forEach(v => {
          const o = document.createElement("option");
          o.value = v.voiceURI;
          o.textContent = v.name.replace(/^Microsoft\s+/, "").replace(/\s*-\s*Chinese.*/i, "");
          og.appendChild(o);
        });
        voiceSelect.appendChild(og);
      });
    }

    if (!state.voiceURI) state.voiceURI = pickDefaultVoiceURI();
    if (voices.some(v => v.voiceURI === state.voiceURI)) {
      voiceSelect.value = state.voiceURI;
    } else if (voices.length) {
      state.voiceURI = pickDefaultVoiceURI();
      voiceSelect.value = state.voiceURI;
    } else {
      voiceSelect.value = "";
    }
    checkVoiceAvailable();
  }

  let voiceCheckTimer = null;
  function checkVoiceAvailable() {
    if (!supportsTTS) {
      voiceWarn.hidden = false;
      voiceWarn.innerHTML = "⚠️ 当前浏览器不支持语音合成，无法朗读。请使用 Chrome / Edge 等现代浏览器打开。";
      return;
    }
    const hasZh = voices.some(v => /^zh/i.test(v.lang));
    voiceWarn.hidden = hasZh;
    if (!hasZh && voices.length) {
      voiceWarn.innerHTML = "⚠️ 没有检测到中文语音包，朗读可能会读成英文。请在系统设置中安装中文语音（Windows：设置 → 时间和语言 → 语言 → 中文 → 语音包），或使用 Edge 浏览器。";
    }
    if (voiceCheckTimer) clearTimeout(voiceCheckTimer);
    voiceCheckTimer = setTimeout(() => {
      if (!voices.some(v => /^zh/i.test(v.lang))) {
        voiceWarn.hidden = false;
        voiceWarn.innerHTML = "⚠️ 没有检测到中文语音包，朗读可能不可用或发音不标准。建议使用 Chrome / Edge，或在系统中安装中文语音包。";
      }
    }, 2000);
  }

  if (supportsTTS) {
    refreshVoices();
    synth.addEventListener("voiceschanged", refreshVoices);
    // 部分浏览器 voices 列表延迟就绪
    setTimeout(refreshVoices, 300);
    setTimeout(refreshVoices, 1000);
  } else {
    voiceWarn.hidden = false;
    voiceWarn.innerHTML = "⚠️ 当前浏览器不支持语音合成（Web Speech API），朗读功能不可用。建议使用 Chrome / Edge 打开。";
  }

  /** 朗读一段文本；返回在朗读结束（或超时兜底）时 resolve 的 Promise */
  function speak(text, opts) {
    const o = opts || {};
    if (!supportsTTS || !text) return Promise.resolve();
    // 单次点读时先打断之前的朗读
    if (!o.queue) { synth.cancel(); }
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      const v = currentVoice();
      if (v) u.voice = v;
      u.lang = (v && v.lang) || "zh-CN";
      u.rate = state.rate;
      u.pitch = 1;
      u.volume = 1;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      // 兜底：某些浏览器不触发 onend
      const guard = (1000 + text.length * 420) / Math.max(state.rate, 0.4) + 1500;
      const timer = setTimeout(finish, guard);
      const wrap = () => clearTimeout(timer);
      u.addEventListener("end", wrap);
      u.addEventListener("error", wrap);
      try { synth.speak(u); } catch (e) { finish(); }
    });
  }

  function stopAll() {
    state.playToken++;
    state.playing = false;
    if (supportsTTS) synth.cancel();
    playAllBtn.textContent = "▶ 连续朗读本页";
    stopBtn.disabled = true;
    highlightCard(null);
  }

  function highlightCard(el) {
    grid.querySelectorAll(".card.speaking").forEach(c => c.classList.remove("speaking"));
    if (el) {
      el.classList.add("speaking");
      if (el.scrollIntoView) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  /* ---------- 渲染 ---------- */
  function normalize(s) {
    return String(s).toLowerCase().replace(/[\s·]/g, "");
  }

  function toneFree(pinyin) {
    const map = {
      "ā":"a","á":"a","ǎ":"a","à":"a","ē":"e","é":"e","ě":"e","è":"e",
      "ī":"i","í":"i","ǐ":"i","ì":"i","ō":"o","ó":"o","ǒ":"o","ò":"o",
      "ū":"u","ú":"u","ǔ":"u","ù":"u","ǖ":"v","ǘ":"v","ǚ":"v","ǜ":"v","ü":"v"
    };
    return pinyin.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g, m => map[m] || m);
  }

  function matches(item, q) {
    const nq = normalize(q);
    if (!nq) return true;
    if (item.char.includes(nq)) return true;
    if (normalize(item.pinyin).includes(nq)) return true;
    if (normalize(toneFree(item.pinyin)).includes(nq)) return true;
    if (normalize(item.meaning).includes(nq)) return true;
    if (item.words.some(w => normalize(w).includes(nq))) return true;
    return false;
  }

  function computeList() {
    let list = state.cat === "all" ? ALL : ALL.filter(i => i.catId === state.cat);
    if (state.query.trim()) list = list.filter(i => matches(i, state.query));
    state.list = list;
  }

  function renderChips() {
    const items = [{ id: "all", name: "全部", icon: "📚" }].concat(
      DATA.map(c => ({ id: c.id, name: c.name, icon: c.icon }))
    );
    chipNav.innerHTML = "";
    items.forEach(it => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (state.cat === it.id ? " active" : "");
      b.dataset.cat = it.id;
      b.innerHTML = `<span>${it.icon}</span><span>${it.name}</span>`;
      b.addEventListener("click", () => {
        stopAll();
        state.cat = it.id;
        computeList();
        renderChips();
        renderGrid();
      });
      chipNav.appendChild(b);
    });
  }

  function renderGrid() {
    grid.innerHTML = "";
    emptyTip.hidden = state.list.length > 0;

    const frag = document.createDocumentFragment();
    state.list.forEach(item => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "card";
      b.dataset.char = item.char;
      b.setAttribute("aria-label", `${item.char}，读音 ${item.pinyin}`);
      b.innerHTML =
        `<span class="c">${item.char}</span>` +
        `<span class="p">${item.pinyin.split("/")[0].trim()}</span>` +
        `<span class="s">${item.words[0] || ""}</span>`;
      b.addEventListener("click", () => {
        speak(item.char);
        openDetail(item);
      });
      frag.appendChild(b);
    });
    grid.appendChild(frag);

    const catName = state.cat === "all"
      ? "全部分类"
      : (DATA.find(c => c.id === state.cat) || {}).name || "";
    statusLine.innerHTML = state.query.trim()
      ? `搜索“<b>${escapeHtml(state.query.trim())}</b>”，找到 <b>${state.list.length}</b> 个字`
      : `${catName} · 共 <b>${state.list.length}</b> 个字，点击字卡即可听读音`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  /* ---------- 详情 ---------- */
  function openDetail(item) {
    state.current = item;
    detailChar.textContent = item.char;
    detailPinyin.textContent = item.pinyin;
    detailMeaning.textContent = item.meaning;
    detailTag.textContent = `${item.catIcon} ${item.catName}`;

    detailWords.innerHTML = "";
    item.words.forEach(w => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "word-btn";
      b.innerHTML = `<span>${w}</span><span class="spk">🔊</span>`;
      b.addEventListener("click", () => speak(w));
      detailWords.appendChild(b);
    });

    // 例句式整读按钮
    detailSpeak.textContent = `🔊 朗读「${item.char}」`;
    detailMask.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDetail() {
    detailMask.hidden = true;
    if (quizMask.hidden) document.body.style.overflow = "";
  }

  function step(delta) {
    if (!state.list.length) return;
    const idx = state.list.indexOf(state.current);
    const next = state.list[(idx + delta + state.list.length) % state.list.length];
    speak(next.char);
    openDetail(next);
  }

  detailSpeak.addEventListener("click", () => {
    if (state.current) speak(state.current.char);
  });
  detailWords.addEventListener("click", e => {
    const btn = e.target.closest(".word-btn");
    if (btn) speak(btn.firstChild.textContent);
  });
  prevChar.addEventListener("click", () => step(-1));
  nextChar.addEventListener("click", () => step(1));
  detailClose.addEventListener("click", closeDetail);
  detailMask.addEventListener("click", e => { if (e.target === detailMask) closeDetail(); });

  /* ---------- 连续朗读 ---------- */
  async function playAll() {
    if (state.playing) { stopAll(); return; }
    const list = state.list.slice();
    if (!list.length) return;

    if (supportsTTS) synth.cancel();       // 先清空队列，避免和单次点读混在一起
    await new Promise(r => setTimeout(r, 120));

    state.playing = true;
    const token = ++state.playToken;
    playAllBtn.textContent = "⏸ 停止朗读";
    stopBtn.disabled = false;

    const cards = Array.from(grid.querySelectorAll(".card"));
    for (let i = 0; i < list.length; i++) {
      if (token !== state.playToken || !state.playing) break;
      const item = list[i];
      highlightCard(cards[i]);
      const text = item.words[0] ? `${item.char}，${item.words[0]}` : item.char;
      await speak(text, { queue: true });
      await new Promise(r => setTimeout(r, 260));
    }

    if (token === state.playToken) {
      state.playing = false;
      playAllBtn.textContent = "▶ 连续朗读本页";
      stopBtn.disabled = true;
      highlightCard(null);
    }
  }

  playAllBtn.addEventListener("click", playAll);
  stopBtn.addEventListener("click", stopAll);

  /* ---------- 搜索 ---------- */
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearSearch.hidden = !searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      stopAll();
      state.query = searchInput.value;
      computeList();
      renderGrid();
    }, 160);
  });
  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    clearSearch.hidden = true;
    state.query = "";
    computeList();
    renderGrid();
    searchInput.focus();
  });

  /* ---------- 设置 ---------- */
  rateRange.addEventListener("input", () => {
    state.rate = parseFloat(rateRange.value);
    rateValue.textContent = state.rate.toFixed(1) + "×";
    prefs.save();
  });

  voiceSelect.addEventListener("change", () => {
    state.voiceURI = voiceSelect.value;
    prefs.save();
    speak("你好，我是朗读小助手");
  });

  themeBtn.addEventListener("click", () => {
    state.night = !state.night;
    applyTheme();
    prefs.save();
  });

  function applyTheme() {
    document.body.classList.toggle("night", state.night);
    themeBtn.textContent = state.night ? "☀️ 日间" : "🌙 夜间";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.night ? "#17181c" : "#c8452f");
  }

  /* ---------- 听音选字 ---------- */
  const quiz = { answer: null, pool: [], score: 0, total: 0, locked: false };

  function quizPool() {
    const base = state.list.length >= 6 ? state.list : ALL;
    // 同拼音的字不适合当干扰项；这里简单去重汉字即可
    return base;
  }

  function newQuestion() {
    const pool = quizPool();
    quiz.locked = false;
    quizFeedback.textContent = "";
    quizFeedback.className = "quiz-feedback";

    if (!pool.length) return;
    const target = pool[Math.floor(Math.random() * pool.length)];
    quiz.answer = target;
    const opts = [target];
    const guard = new Set([target.char]);
    let tries = 0;
    while (opts.length < 4 && tries < 400) {
      tries++;
      const cand = pool[Math.floor(Math.random() * pool.length)];
      if (guard.has(cand.char)) continue;
      guard.add(cand.char);
      opts.push(cand);
    }
    opts.sort(() => Math.random() - 0.5);

    quizOptions.innerHTML = "";
    opts.forEach(o => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.textContent = o.char;
      b.addEventListener("click", () => answer(b, o));
      quizOptions.appendChild(b);
    });

    setTimeout(() => speak(target.char), 220);
  }

  function answer(btn, chosen) {
    if (quiz.locked) return;
    quiz.locked = true;
    quiz.total++;
    const correct = chosen.char === quiz.answer.char;

    if (correct) {
      quiz.score++;
      btn.classList.add("right");
      quizFeedback.textContent = "🎉 答对啦！读音是 " + quiz.answer.pinyin;
      quizFeedback.className = "quiz-feedback ok";
      speak("答对了");
    } else {
      btn.classList.add("wrong");
      Array.from(quizOptions.children).forEach(b => {
        if (b.textContent === quiz.answer.char) b.classList.add("right");
      });
      quizFeedback.textContent = "再听听～ 正确答案是「" + quiz.answer.char + "」" + quiz.answer.pinyin;
      quizFeedback.className = "quiz-feedback no";
      speak("正确答案是" + quiz.answer.char);
    }

    quizScoreEl.textContent = quiz.score;
    quizTotalEl.textContent = quiz.total;
  }

  quizBtn.addEventListener("click", () => {
    stopAll();
    quizMask.hidden = false;
    document.body.style.overflow = "hidden";
    newQuestion();
  });
  quizClose.addEventListener("click", () => { quizMask.hidden = true; if (detailMask.hidden) document.body.style.overflow = ""; });
  quizMask.addEventListener("click", e => { if (e.target === quizMask) { quizMask.hidden = true; if (detailMask.hidden) document.body.style.overflow = ""; } });
  quizPlay.addEventListener("click", () => { if (quiz.answer) speak(quiz.answer.char); });
  quizNext.addEventListener("click", newQuestion);

  /* ---------- 快捷键 ---------- */
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (!detailMask.hidden) closeDetail();
      else if (!quizMask.hidden) { quizMask.hidden = true; document.body.style.overflow = ""; }
      else if (state.playing) stopAll();
      return;
    }
    if (!detailMask.hidden) {
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      if (e.key === " " || e.key === "Enter") {
        if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
        e.preventDefault();
        if (state.current) speak(state.current.char);
      }
    }
  });

  /* ---------- 启动 ---------- */
  prefs.load();
  applyTheme();
  rateRange.value = String(state.rate);
  rateValue.textContent = state.rate.toFixed(1) + "×";
  refreshVoices();
  computeList();
  renderChips();
  renderGrid();

  // 页面隐藏时停止朗读，避免"幽灵朗读"
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAll();
  });
})();
