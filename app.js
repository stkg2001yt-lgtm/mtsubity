/* =======================================
 * app.js — 寮生掲示板（BRIGHTY 管理）
 * jQuery + Firebase RTDB（CDN）
 * ======================================= */

/* --- Firebase & Gemini 設定 --- */
const firebaseConfig = {
    apiKey: "AIzaSyBDEx6TnK_AbnkrGDUbWXGnu0WBwLku0N8",
    authDomain: "mitsuty-d9c2a.firebaseapp.com",
    databaseURL: "https://mitsuty-d9c2a-default-rtdb.firebaseio.com",
    projectId: "mitsuty-d9c2a",
    storageBucket: "mitsuty-d9c2a.firebasestorage.app",
    messagingSenderId: "1064899582432",
    appId: "1:1064899582432:web:8bc4a07f82d0783c793385",
    measurementId: "G-PDSY94BEH6",
};

// ★新キー＆最軽量モデル
const GEMINI_API_KEY = "AIzaSyAGoexkxhfISoXZs0ItBYgXC9UGvSm50UM";
const GEMINI_MODEL_SUMMARY = "gemini-1.5-flash-8b";
const GEMINI_MODEL_AI = "gemini-1.5-flash-8b";

/* --- オプション/定数 --- */
const PAGE_SIZE = 100;                     // タイムライン1ページ
const SUMMARY_INTERVAL_MS = 15 * 60 * 1000;// 要約の自動更新
const AI_AUTO = false;                     // ★AI住人の自動書き込みはオフ（手動のみ）
const BRIGHTY_NAME = "BRIGHTY";
const BRIGHTY_ANONID = "BRIGHTY";

/* --- 状態 --- */
let db = null;
const STATE = {
    anonId: null,
    displayName: null,
    threads: {},
    filters: { dorm: "", tag: "", text: "", sort: "new" },
    paging: { page: 1, size: PAGE_SIZE },
    openThreads: {},   // ひらく中のスレIDを保持（再描画で閉じない）
    _subscribed: false
};

/* --- 小物 --- */
const debounce = (f, m) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => f(...a), m); }; };
const fmt = (ts) => {
    if (!ts) return "-"; const d = new Date(ts);
    return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\s/g, " ");
};
const genId = (n = 8) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.random() * 36 | 0]).join("");
const isB = (a) => (a?.name === BRIGHTY_NAME) || (a?.anonId === BRIGHTY_ANONID);

/* --- 起動 --- */
$(function () { initFirebase(); boot(); });

function initFirebase(retry = 8) {
    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        if (!STATE._subscribed) { subscribe(); STATE._subscribed = true; }
    } catch (e) { if (retry) setTimeout(() => initFirebase(retry - 1), 500); }
}

function boot() {
    // 匿名ID
    let id = localStorage.getItem("anonId");
    if (!id) { id = genId(); localStorage.setItem("anonId", id); }
    STATE.anonId = id;
    STATE.displayName = localStorage.getItem("displayName") || "";
    $("#userIdBox").text(`あなたのID: ${STATE.anonId}`);

    // 画面遷移
    $(document).on("click", ".go-post,#btnGoPost", (e) => { e.preventDefault(); $(".view").removeClass("active"); $("#postView").addClass("active"); });
    $(document).on("click", ".back-home", (e) => { e.preventDefault(); $(".view").removeClass("active"); $("#homeView").addClass("active"); });

    // フィルタ
    $(".dorm-tab").on("click", function () {
        $(".dorm-tab").removeClass("active"); $(this).addClass("active");
        STATE.filters.dorm = $(this).data("dorm") || ""; renderList();
    });
    $("#tagQuick").on("change", () => { STATE.filters.tag = $("#tagQuick").val(); renderList(); });
    $("#textSearch").on("input", debounce(() => { STATE.filters.text = $("#textSearch").val().trim(); renderList(); }, 200));
    $("#sortBy").on("change", () => { STATE.filters.sort = $("#sortBy").val(); renderList(); });

    // 新規スレ投稿
    $("#postForm").on("submit", createThread);
    $("#btnSubmit").on("click", (e) => { e.preventDefault(); $("#postForm").trigger("submit"); });

    // 要約（自動/手動）
    $("#btnSummaryNow").on("click", () => runSummary({ force: true }));
    setInterval(() => runSummary({ force: false }), SUMMARY_INTERVAL_MS);

    // BRIGHTY 手動のみ
    $("#btnAiNow").on("click", () => brightyTick({ force: true }));
    // if (AI_AUTO) setInterval(()=> brightyTick(), 5*60*1000); // ← オフ
}

/* --- RTDB 購読 --- */
function subscribe() {
    db.ref("threads").on("value", (s) => {
        STATE.threads = s.val() || {};
        renderList();
        renderRanking();
    });
}

/* --- ランキング（上位5件） --- */
function hotScore(t) {
    const m = t.meta || {}; const r = m.repliesTotal || 0, l = m.likesTotal || 0, s = m.stampsTotal || 0, v = m.viewsTotal || 0;
    const age = Math.max(1, (Date.now() - (t.updatedAt || t.createdAt || 0)) / 3600000);
    return Math.round((r * 5 + l * 2 + s * 2 + v * 0.5) / Math.sqrt(age));
}
function renderRanking() {
    const ul = $("#rankingList").empty();
    const rows = Object.values(STATE.threads || {})
        .map(t => ({ ...t, _hot: hotScore(t) }))
        .sort((a, b) => (b._hot || 0) - (a._hot || 0))
        .slice(0, 5);
    if (!rows.length) { ul.append($("<li>").addClass("muted").text("まだ投稿がありません。")); return; }
    rows.forEach(t => {
        const li = $("<li>");
        const a = $("<a>").attr("href", "javascript:void(0)").text(t.title || "（無題・雑談）")
            .on("click", () => {
                const el = $(`[data-thread='${t.id}'] .thread-body`);
                if (el.length && !el.hasClass("active")) {
                    el.addClass("active");
                    $(`[data-thread='${t.id}'] .toggle-thread`).text("とじる");
                    loadPosts(t.id, el.find(".posts"));
                }
                $('html,body').animate({ scrollTop: $(`[data-thread='${t.id}']`).offset().top - 40 }, 200);
            });
        const meta = $("<div>").addClass("rank-meta").text(`勢い:${t._hot} / 返信:${t.meta?.repliesTotal || 0} いいね:${t.meta?.likesTotal || 0}`);
        li.append(a, meta); ul.append(li);
    });
}

/* --- タイムライン（100件ページング） --- */
function filteredRows() {
    const rows = Object.entries(STATE.threads).map(([id, t]) => ({ id, ...t }));
    return rows.filter(r => {
        if (STATE.filters.dorm && r.dorm !== STATE.filters.dorm) return false;
        if (STATE.filters.tag) {
            const tags = (r.tags || []).map(x => String(x).trim());
            if (!tags.includes(STATE.filters.tag)) return false;
        }
        if (STATE.filters.text) {
            const q = STATE.filters.text.toLowerCase();
            const t = (r.title || "").toLowerCase();
            const p = (r.firstPostPreview || "").toLowerCase();
            if (!t.includes(q) && !p.includes(q)) return false;
        }
        return true;
    });
}

function renderList() {
    const list = $("#threadList").empty();
    let rows = filteredRows();

    if (!Object.keys(STATE.threads).length) { list.append($("<div>").addClass("muted").text("まだ投稿がありません。")); $("#pager").empty(); return; }
    if (!rows.length) { list.append($("<div>").addClass("muted").text("該当なし。フィルタを見直してください。")); $("#pager").empty(); return; }

    rows.forEach(t => t._hot = hotScore(t));
    const s = STATE.filters.sort;
    if (s === "hot") rows.sort((a, b) => (b._hot || 0) - (a._hot || 0));
    else if (s === "likes") rows.sort((a, b) => ((b.meta?.likesTotal || 0) - (a.meta?.likesTotal || 0)));
    else if (s === "views") rows.sort((a, b) => ((b.meta?.viewsTotal || 0) - (a.meta?.viewsTotal || 0)));
    else rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // ページング
    const totalPages = Math.max(1, Math.ceil(rows.length / STATE.paging.size));
    STATE.paging.page = Math.min(Math.max(1, STATE.paging.page), totalPages);
    const start = (STATE.paging.page - 1) * STATE.paging.size;
    const pageRows = rows.slice(start, start + STATE.paging.size);
    renderPager(totalPages);

    // 行描画
    pageRows.forEach(t => {
        const card = $("<section>").addClass("card").attr("data-thread", t.id);

        const head = $("<div>").addClass("thread-head");
        const title = $("<h3>").addClass("thread-title truncate").text(t.title || "（無題・雑談）");
        const badges = $("<div>").addClass("badges");
        badges.append($("<span>").addClass("badge accent").text(t.type === "free" ? "譲/求" : "雑談"));
        if (t.dorm) badges.append($("<span>").addClass("badge").text(t.dorm));
        (t.tags || []).forEach(tag => badges.append($("<span>").addClass("badge").text(tag)));
        const metaInline = $("<span>").addClass("thread-meta-inline truncate").text(`勢い:${t._hot} / 返信:${t.meta?.repliesTotal || 0} / いいね:${t.meta?.likesTotal || 0}`);

        const body = $("<div>").addClass("thread-body");
        const toggle = $("<button>").addClass("ghost toggle-thread").text("ひらく").on("click", () => {
            body.toggleClass("active");
            const opened = body.hasClass("active");
            toggle.text(opened ? "とじる" : "ひらく");
            if (opened) {
                STATE.openThreads[t.id] = true;
                const postsWrap = body.find(".posts");
                if (!postsWrap.data("bound")) { loadPosts(t.id, postsWrap); postsWrap.data("bound", true); }
            } else {
                delete STATE.openThreads[t.id];
            }
        });
        head.append(title, badges, metaInline, toggle);

        // 投稿表示＋返信UI
        const postsWrap = $("<div>").addClass("posts").append($("<div>").addClass("muted").text("読み込み中…"));

        // 返信UI
        const reply = $("<div>").addClass("reply-box");
        const nm = $("<input>").attr({ type: "text", placeholder: "ななしさん" }).val(localStorage.getItem("displayName") || "");
        const ta = $("<textarea>").attr({ rows: 3, placeholder: "内容" });
        const file = $("<input>").attr({ type: "file", accept: "image/*" });
        const send = $("<button>").addClass("primary").text("返信").on("click", async () => {
            const name = nm.val().trim(); if (name) { localStorage.setItem("displayName", name); STATE.displayName = name; }
            const content = ta.val().trim(); if (!content && !file[0].files.length) { alert("本文か画像のどちらかは必要です"); return; }
            let img = null; if (file[0].files.length) img = await fileToDataURL(file[0].files[0], 1280);
            await addReply(t.id, { author: { anonId: STATE.anonId, name: name || null }, content, image: img, createdAt: Date.now() });
            ta.val(""); file.val("");
        });

        // スタンプ（ワンタップ返信）
        const stamps = ["👍", "😂", "🎉", "🙏", "🍜", "🛠️", "📦", "🧹"];
        const sRow = $("<div>").addClass("stamp-row");
        stamps.forEach(em => {
            const b = $("<button>").addClass("stamp-btn").attr("type", "button").text(em).on("click", async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const name = nm.val().trim(); if (name) { localStorage.setItem("displayName", name); STATE.displayName = name; }
                await addReply(t.id, { author: { anonId: STATE.anonId, name: name || null }, content: em, stamp: true, stampEmoji: em, createdAt: Date.now() });
            });
            sRow.append(b);
        });

        reply.append(nm, ta, file, $("<div>").addClass("reply-actions").append(send), sRow);
        body.append($("<div>").addClass("muted").text("スレッドの投稿"), postsWrap, reply);

        // 再描画時に開き直す（いいね押下で閉じない）
        if (STATE.openThreads[t.id]) {
            body.addClass("active"); toggle.text("とじる");
            const pw = body.find(".posts"); if (!pw.data("bound")) { loadPosts(t.id, pw); pw.data("bound", true); }
        }

        card.append(head, body);
        list.append(card);
    });
}

/* --- ページャー --- */
function renderPager(totalPages) {
    const p = $("#pager").empty();
    if (totalPages <= 1) return;
    const page = STATE.paging.page;
    const makeBtn = (label, target, disabled = false, active = false) => {
        const b = $("<button>").text(label);
        if (disabled) b.attr("disabled", true);
        if (active) b.addClass("current");
        b.on("click", () => { STATE.paging.page = target; renderList(); window.scrollTo({ top: 0, behavior: "smooth" }); });
        return b;
    };
    p.append(makeBtn("«", 1, page === 1), makeBtn("‹", Math.max(1, page - 1), page === 1));
    const start = Math.max(1, page - 2), end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) p.append(makeBtn(String(i), i, false, i === page));
    p.append(makeBtn("›", Math.min(totalPages, page + 1), page === totalPages), makeBtn("»", totalPages, page === totalPages));
}

/* --- 投稿描画 & いいね（Twitter風） --- */
function postNode(p, tid, key) {
    const n = $("<div>").addClass("post").toggleClass("brighty", isB(p.author));
    const h = $("<div>").addClass("post-head");
    if (isB(p.author)) h.append($("<img>").addClass("avatar-s").attr("src", "brighty.png").attr("alt", "BRIGHTY"));
    h.append($("<span>").addClass("author").text(p.author?.name || `ID:${String(p.author?.anonId || "").slice(0, 6)}`));
    h.append($("<span>").addClass("muted").css("margin-left", "6px").text(fmt(p.createdAt)));
    n.append(h);

    if (p.stamp === true || p.stampEmoji) {
        n.append($("<div>").addClass("stamp-bubble").text(p.stampEmoji || p.content || "👍"));
    } else {
        if (p.content && String(p.content).length > 0) n.append($("<div>").text(p.content));
        if (p.image) n.append($("<img>").attr("src", p.image));
    }

    n.append(likeUI(tid, key, p.likesTotal || 0));
    return n;
}

function likeUI(tid, key, total0) {
    const wrap = $("<div>").addClass("like");
    const btn = $("<button>").addClass("like-btn").attr("type", "button").append($(svgHeart()));
    const cnt = $("<span>").addClass("like-count").text(total0 || 0);
    wrap.append(btn, cnt);

    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    wrap.on("click", stop); cnt.on("click", stop);

    const userRef = db.ref(`threads/${tid}/likes/${key}/${STATE.anonId}`);
    const postLikes = db.ref(`threads/${tid}/posts/${key}/likesTotal`);
    const threadLikes = db.ref(`threads/${tid}/meta/likesTotal`);

    function setLiked(v) { btn.toggleClass("liked", !!v); }
    userRef.on("value", (s) => setLiked(!!s.val()));
    postLikes.on("value", (s) => cnt.text(s.val() || 0));

    btn.on("click", async (e) => {
        stop(e);
        const liked = btn.hasClass("liked");
        if (liked) {
            setLiked(false);
            await Promise.all([
                userRef.remove(),
                postLikes.transaction(c => Math.max(0, (c || 0) - 1)),
                threadLikes.transaction(c => Math.max(0, (c || 0) - 1))
            ]);
        } else {
            setLiked(true);
            await Promise.all([
                userRef.set(true),
                postLikes.transaction(c => (c || 0) + 1),
                threadLikes.transaction(c => (c || 0) + 1)
            ]);
        }
    });

    return wrap;
}

const svgHeart = () => `
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
</svg>`;

/* --- 画像圧縮 --- */
function fileToDataURL(file, maxW = 1280) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
            const img = new Image(); img.onload = () => {
                const s = Math.min(1, maxW / img.width), w = Math.round(img.width * s), h = Math.round(img.height * s);
                const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(img, 0, 0, w, h);
                resolve(cv.toDataURL("image/jpeg", 0.8));
            }; img.onerror = reject; img.src = fr.result;
        };
        fr.onerror = reject; fr.readAsDataURL(file);
    });
}

/* --- 投稿/返信 --- */
async function createThread(e) {
    e.preventDefault();
    const btn = $("#btnSubmit").prop("disabled", true).text("投稿してるよ");
    try {
        const name = $("#inputName").val().trim();
        const dorm = $("#inputDorm").val();
        const type = $("#inputType").val() || "chat";
        const title = $("#inputTitle").val().trim();
        const content = $("#inputContent").val().trim();
        const tag = $("#inputTag").val(); const tags = tag ? [tag] : [];
        if (!title) throw new Error("タイトルは必須だよ");

        let imageData = null; const f = $("#inputImage")[0];
        if (f?.files?.length) imageData = await fileToDataURL(f.files[0], 1280);
        if (name) { localStorage.setItem("displayName", name); STATE.displayName = name; }

        const now = Date.now();
        const threadRef = db.ref("threads").push(); const threadId = threadRef.key;
        const firstKey = db.ref(`threads/${threadId}/posts`).push().key;
        const data = {
            id: threadId, type, title, dorm: dorm || "", tags,
            createdBy: { anonId: STATE.anonId, name: name || null },
            firstPostPreview: content.slice(0, 100), firstImage: imageData || null,
            createdAt: now, updatedAt: now,
            meta: { repliesTotal: 1, likesTotal: 0, stampsTotal: 0, viewsTotal: 0 },
            posts: { [firstKey]: { author: { anonId: STATE.anonId, name: name || null }, content, image: imageData || null, createdAt: now, likesTotal: 0 } }
        };
        await db.ref(`threads/${threadId}`).set(data);

        alert("投稿したよ");
        $("#postForm")[0].reset();
        $(".view").removeClass("active"); $("#homeView").addClass("active");
    } catch (err) {
        alert("投稿に失敗したよ: " + (err?.message || err));
    } finally {
        btn.prop("disabled", false).text("投稿する");
    }
}

async function addReply(threadId, post) {
    if (!db) throw new Error("DB未接続");
    const key = db.ref(`threads/${threadId}/posts`).push().key;
    const now = post?.createdAt || Date.now();

    const snap = await db.ref(`threads/${threadId}/posts`).get();
    const replies = (snap.exists() ? snap.numChildren() : 0) + 1;

    const up = {};
    up[`threads/${threadId}/posts/${key}`] = { ...post, likesTotal: post?.likesTotal || 0 };
    up[`threads/${threadId}/updatedAt`] = now;
    up[`threads/${threadId}/meta/repliesTotal`] = replies;
    await db.ref().update(up);

    if (post?.stamp) { await db.ref(`threads/${threadId}/meta/stampsTotal`).transaction(c => (c || 0) + 1); }
}

function loadPosts(threadId, container) {
    db.ref(`threads/${threadId}/posts`).orderByChild("createdAt").limitToLast(100).on("value", (s) => {
        const arr = []; s.forEach(ch => arr.push({ key: ch.key, ...ch.val() }));
        arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        container.empty();
        arr.forEach(p => container.append(postNode(p, threadId, p.key)));
    });
}

/* --- Gemini（要約 & BRIGHTYの文生成） --- */
async function callGeminiText(prompt, model) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) return "";
        const d = await res.json(); return d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch { return ""; }
}

function buildSummaryPrompt(items) {
    const lines = items.map(x => `• [${x.dorm || "-"}](${x.type}) ${x.title || "（無題）"} / ${(x.tags || []).join("/") || "no-tags"} / ${fmt(x.createdAt)}\n  ${(x.content || "").slice(0, 140)}`).join("\n");
    return `あなたは寮掲示板の管理人AI「BRIGHTY」。超フレンドリーに簡潔に要約。\n${lines}`;
}
function localSummary(items) {
    const top = items.slice(0, 7).map(x => `・${x.title || "（無題）"} @${x.dorm || "-"}`).join("\n");
    return `（ローカル要約）最近の話題：\n${top}`;
}
let LAST_SUMMARY_KEY = "", LAST_SUMMARY_AT = 0;

async function getRecentForSummary(n) {
    const snap = await db.ref("threads").orderByChild("updatedAt").limitToLast(n).get();
    const val = snap.val() || {}; const arr = Object.values(val).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const out = [];
    for (const t of arr) {
        const ps = await db.ref(`threads/${t.id}/posts`).orderByChild("createdAt").limitToFirst(1).get();
        const first = Object.values(ps.val() || {})[0] || {};
        out.push({ type: t.type, dorm: t.dorm, title: t.title, tags: t.tags || [], createdAt: t.createdAt || t.updatedAt, content: first.content || "" });
    }
    return out;
}

function maybeStatus(msg) {
    const el = $("#summaryStatus"); if (!el.length) return;
    if (!msg) { const next = new Date(Date.now() + SUMMARY_INTERVAL_MS); el.text(`次回自動更新: ${next.toLocaleTimeString("ja-JP")}`); }
    else { el.text(msg); setTimeout(() => maybeStatus(), 2000); }
}

async function runSummary({ force = false } = {}) {
    try {
        const recent = await getRecentForSummary(20);
        if (!recent.length) { $("#summaryContent").text("まだ投稿がないよ。"); return; }
        const key = JSON.stringify(recent.map(x => [x.dorm, x.type, x.title, x.createdAt]));
        const now = Date.now();
        if (!force && key === LAST_SUMMARY_KEY && (now - LAST_SUMMARY_AT) < (10 * 60 * 1000)) { maybeStatus("変更"); return; }
        maybeStatus("要約中…");
        const text = (await callGeminiText(buildSummaryPrompt(recent), GEMINI_MODEL_SUMMARY)) || localSummary(recent);
        $("#summaryContent").text(text);
        LAST_SUMMARY_KEY = key; LAST_SUMMARY_AT = now; maybeStatus("更新済み");
    } catch {
        $("#summaryContent").text("要約でエラーが発生しちゃった。。");
    }
}

/* --- BRIGHTY（手動トリガ用） --- */
async function brightyTick() {
    // 返信寄りで自然に一言
    const rows = Object.entries(STATE.threads || {}).map(([id, t]) => ({ id, ...t })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!rows.length) return brightyCreate();

    // 直近スレから文脈を拾って一言返信
    const pick = rows[Math.floor(Math.random() * Math.min(5, rows.length))];
    const pSnap = await db.ref(`threads/${pick.id}/posts`).orderByChild("createdAt").limitToLast(5).get();
    const posts = Object.values(pSnap.val() || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const ctx = posts.map(p => `- ${p.author?.name || ("ID:" + String(p.author?.anonId || "").slice(0, 6))}: ${(p.content || "").replace(/\s+/g, " ").slice(0, 120)}`).join("\n");
    const prompt = `あなたは寮掲示板の管理人AI「BRIGHTY」。気さくで饒舌、しかし簡潔に。超フレンドリーに直近の発言に1～2文で自然に返信してください。出力は本文のみ。\nスレ:${pick.title}\n${ctx || "(本文なし)"}`;
    const text = (await callGeminiText(prompt, GEMINI_MODEL_AI)) || "ナイスです。具体的な条件や時間帯があれば、ここで擦り合わせましょう。";
    await addReply(pick.id, { author: { anonId: BRIGHTY_ANONID, name: BRIGHTY_NAME }, content: text, createdAt: Date.now() });
}

async function brightyCreate() {
    const dorms = ["神楽坂寮", "木場寮", "高島平寮"]; const dorm = dorms[Math.floor(Math.random() * dorms.length)];
    const t = "ちょっとしたお知らせ"; const c = "共有まで。ご意見あれば返信ください。"; const now = Date.now();
    const ref = db.ref("threads").push(); const tid = ref.key; const first = db.ref(`threads/${tid}/posts`).push().key;
    const data = {
        id: tid, type: "chat", title: t, dorm, tags: ["雑談"],
        createdBy: { anonId: BRIGHTY_ANONID, name: BRIGHTY_NAME },
        firstPostPreview: c.slice(0, 100), firstImage: null,
        createdAt: now, updatedAt: now,
        meta: { repliesTotal: 1, likesTotal: 0, stampsTotal: 0, viewsTotal: 0 },
        posts: { [first]: { author: { anonId: BRIGHTY_ANONID, name: BRIGHTY_NAME }, content: c, image: null, createdAt: now, likesTotal: 0 } }
    };
    await db.ref(`threads/${tid}`).set(data);
}
