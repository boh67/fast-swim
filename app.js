const $ = s => document.querySelector(s);
const supabaseClient = window.supabase.createClient(
  window.FAST_SWIM_CONFIG.supabaseUrl,
  window.FAST_SWIM_CONFIG.supabasePublishableKey,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

let currentUser = null;
let profile = null;
let posts = [];
let isSignup = false;
let busy = false;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function setAuthMessage(message) { $("#authMessage").textContent = message; }
function setBusy(value) {
  busy = value;
  $("#authSubmit").disabled = value;
  $("#authSubmit").textContent = value ? "Attendi…" : (isSignup ? "Crea account" : "Accedi");
}
function showLogin() {
  document.body.classList.remove("ready");
  $("#authForm").classList.remove("hidden");
  $("#activateForm").classList.add("hidden");
  $("#signupFields").classList.toggle("hidden", !isSignup);
  $("#authTitle").textContent = isSignup ? "Crea il tuo account" : "Accedi a FAST SWIM";
  $("#authModeToggle").textContent = isSignup ? "Hai già un account? Accedi" : "Non hai un account? Registrati";
  $("#authSubmit").textContent = isSignup ? "Crea account" : "Accedi";
  $("#authPassword").autocomplete = isSignup ? "new-password" : "current-password";
}
function showActivation() {
  document.body.classList.remove("ready");
  $("#authForm").classList.add("hidden");
  $("#authModeToggle").classList.add("hidden");
  $("#activateForm").classList.remove("hidden");
  $("#authTitle").textContent = "Un ultimo passaggio";
  setAuthMessage("Il tuo account è creato, ma resta bloccato finché non inserisci un codice invito valido.");
}
function showApp() {
  $("#authModeToggle").classList.remove("hidden");
  document.body.classList.add("ready");
  renderProfile();
  loadPosts();

  if (!profile.username && !$("#profileDialog").open) {
    $("#nameInput").value = profile.display_name || "";
    $("#usernameInput").value = "";
    $("#bioInput").value = profile.bio || "";
    $("#profileDialog").showModal();
    toast("Scegli uno username per completare il profilo.");
  }
}
function renderProfile() {
  $("#profileName").textContent = profile.display_name || "Membro FAST SWIM";
$("#profileUsername").textContent = profile.username ? "@" + profile.username : "Username non impostato";
$("#profileBio").textContent = profile.bio || "Nuovo nella community ✨";
  $("#myPosts").innerHTML = posts.filter(p => p.user_id === currentUser.id)
    .map(p => `<div class="mini-post">${esc(p.content)}</div>`).join("") ||
    '<p class="hint">I tuoi post appariranno qui.</p>';
  $("#postCount").textContent = posts.filter(p => p.user_id === currentUser.id).length;
}
async function getProfile() {
  const { data, error } = await supabaseClient.from("profiles")
    .select("id,username,display_name,bio,status").eq("id", currentUser.id).maybeSingle();
  if (error) throw error;
  return data;
}
async function activateWithCode(code) {
  const { data, error } = await supabaseClient.rpc("redeem_invite", { p_code: code.trim() });
  if (error) throw error;
  if (data !== true) throw new Error("Codice invito non valido, già utilizzato o scaduto.");
}
async function bootstrap(session) {
  if (!session?.user) {
    currentUser = null; profile = null;
    showLogin();
    return;
  }
  currentUser = session.user;
  try {
    profile = await getProfile();
    if (!profile) throw new Error("Profilo non ancora pronto. Esci e accedi di nuovo tra qualche secondo.");
    if (profile.status !== "active") {
      showActivation();
      return;
    }
    showApp();
  } catch (error) {
    showLogin();
    setAuthMessage("Impossibile caricare il profilo: " + error.message);
  }
}

$("#authModeToggle").addEventListener("click", () => {
  isSignup = !isSignup;
  showLogin();
  setAuthMessage(isSignup
    ? "Crea l'account e inserisci il codice invito che hai generato nel database."
    : "Accedi con email e password.");
});

$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (busy) return;
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  setBusy(true);
  try {
    if (isSignup) {
      const displayName = $("#authDisplayName").value.trim() || "Membro FAST SWIM";
      const invite = $("#authInviteCode").value.trim();
      if (!invite) throw new Error("Inserisci il codice invito.");
      const { data, error } = await supabaseClient.auth.signUp({
        email, password, options: { data: { display_name: displayName } }
      });
      if (error) throw error;
      if (data.session) {
        currentUser = data.user;
        await activateWithCode(invite);
        await bootstrap(data.session);
      } else {
        sessionStorage.setItem("fast_swim_pending_invite", invite);
        setAuthMessage("Account creato. Controlla la tua email per confermare l'indirizzo, poi accedi e inserisci il codice nella schermata di attivazione.");
        isSignup = false;
        showLogin();
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await bootstrap(data.session);
      if (currentUser && profile?.status !== "active") {
        const pendingCode = sessionStorage.getItem("fast_swim_pending_invite");
        if (pendingCode) {
          $("#activateCode").value = pendingCode;
          sessionStorage.removeItem("fast_swim_pending_invite");
        }
      }
    }
  } catch (error) {
    setAuthMessage(error.message || "Si è verificato un errore.");
  } finally {
    setBusy(false);
  }
});

$("#activateForm").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("#activateCode").value.trim();
  const submit = $("#activateForm button");
  submit.disabled = true;
  try {
    await activateWithCode(code);
    const { data } = await supabaseClient.auth.getSession();
    await bootstrap(data.session);
    toast("Account attivato!");
  } catch (error) {
    setAuthMessage(error.message || "Non è stato possibile attivare l'account.");
  } finally {
    submit.disabled = false;
  }
});

async function loadPosts() {
  const { data, error } = await supabaseClient.from("posts")
    .select("id,user_id,content,created_at").order("created_at", { ascending: false }).limit(60);
  if (error) { toast("Errore caricamento post: " + error.message); return; }
  const userIds = [...new Set((data || []).map(p => p.user_id))];
  let profilesById = {};
  let likes = [];
  let comments = [];
  if (userIds.length) {
    const [pr, lr, cr] = await Promise.all([
      supabaseClient.from("profiles").select("id,display_name,username").in("id", userIds),
      supabaseClient.from("likes").select("post_id,user_id").in("post_id", (data || []).map(p => p.id)),
      supabaseClient.from("comments").select("id,post_id,user_id,content,created_at").in("post_id", (data || []).map(p => p.id)).order("created_at")
    ]);
    if (pr.error) { toast(pr.error.message); return; }
    profilesById = Object.fromEntries((pr.data || []).map(p => [p.id, p]));
    likes = lr.data || [];
    comments = cr.data || [];
  }
  const commentUserIds = [...new Set(comments.map(c => c.user_id))].filter(id => !profilesById[id]);
  if (commentUserIds.length) {
    const { data: extraProfiles } = await supabaseClient.from("profiles")
      .select("id,display_name,username").in("id", commentUserIds);
    (extraProfiles || []).forEach(p => profilesById[p.id] = p);
  }
  posts = (data || []).map(p => ({
    ...p,
    author: profilesById[p.user_id]?.display_name || "Membro",
    likes: likes.filter(l => l.post_id === p.id).length,
    liked: likes.some(l => l.post_id === p.id && l.user_id === currentUser.id),
    comments: comments.filter(c => c.post_id === p.id).map(c => ({
      ...c, author: profilesById[c.user_id]?.display_name || "Membro"
    }))
  }));
  renderFeed();
  renderProfile();
}

function renderFeed() {
  $("#feed").innerHTML = posts.map(p => `
    <article class="post">
      <div class="post-head">
        <div class="avatar">${esc((p.author || "FS").slice(0,2).toUpperCase())}</div>
        <div><div class="post-author">${esc(p.author)}</div><div class="post-time">${new Date(p.created_at).toLocaleString("it-IT")}</div></div>
      </div>
      <div class="post-text">${esc(p.content).replace(/\n/g,"<br>")}</div>
      <div class="post-actions">
        <button class="action ${p.liked ? "liked" : ""}" data-like="${p.id}">♥ ${p.likes} Mi piace</button>
        <button class="action" data-comment="${p.id}">▢ ${p.comments.length} Commenti</button>
        ${p.user_id === currentUser.id ? `<button class="action" data-delete="${p.id}">Elimina</button>` : ""}
      </div>
      ${p.comments.map(c => `<div class="post-text comment"><b>${esc(c.author)}:</b> ${esc(c.content)}</div>`).join("")}
    </article>`).join("") || '<div class="empty-panel"><h2>Ancora nessun post</h2><p>Pubblica il primo contenuto della community!</p></div>';
}

$("#postForm").addEventListener("submit", async e => {
  e.preventDefault();
  const content = $("#postText").value.trim();
  if (!content) return;
  const button = $("#postForm button[type=submit]");
  button.disabled = true;
  try {
    const { error } = await supabaseClient.from("posts").insert({ user_id: currentUser.id, content });
    if (error) throw error;
    $("#composeDialog").close();
    $("#postText").value = "";
    await loadPosts();
    toast("Post pubblicato nella community!");
  } catch (error) { toast("Errore: " + error.message); }
  finally { button.disabled = false; }
});

$("#feed").addEventListener("click", async e => {
  const likeButton = e.target.closest("[data-like]");
  const commentButton = e.target.closest("[data-comment]");
  const deleteButton = e.target.closest("[data-delete]");
  try {
    if (likeButton) {
      const postId = likeButton.dataset.like;
      const post = posts.find(p => p.id === postId);
      const result = post.liked
        ? await supabaseClient.from("likes").delete().eq("post_id", postId).eq("user_id", currentUser.id)
        : await supabaseClient.from("likes").insert({ post_id: postId, user_id: currentUser.id });
      if (result.error) throw result.error;
      await loadPosts();
    } else if (commentButton) {
      const postId = commentButton.dataset.comment;
      const content = prompt("Scrivi un commento (massimo 500 caratteri):");
      if (content?.trim()) {
        const { error } = await supabaseClient.from("comments").insert({
          post_id: postId, user_id: currentUser.id, content: content.trim().slice(0,500)
        });
        if (error) throw error;
        await loadPosts();
      }
    } else if (deleteButton) {
      if (!confirm("Vuoi eliminare questo post?")) return;
      const { error } = await supabaseClient.from("posts").delete().eq("id", deleteButton.dataset.delete);
      if (error) throw error;
      await loadPosts();
    }
  } catch (error) { toast("Operazione non riuscita: " + error.message); }
});

$("#editProfile").onclick = () => {
$("#editProfile").onclick = () => {
  $("#nameInput").value = profile.display_name || "";
  $("#usernameInput").value = profile.username || "";
  $("#bioInput").value = profile.bio || "";
  $("#profileDialog").showModal();
};

$("#profileForm").addEventListener("submit", async e => {
  e.preventDefault();

  const display_name = $("#nameInput").value.trim().slice(0, 32) || "Membro FAST SWIM";
  const username = $("#usernameInput").value.trim().toLowerCase();
  const bio = $("#bioInput").value.trim().slice(0, 120);

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    toast("Username: usa 3-20 caratteri, solo lettere, numeri e _.");
    return;
  }

  const { error } = await supabaseClient
    .from("profiles")
    .update({ display_name, username, bio })
    .eq("id", currentUser.id);

  if (error) {
    toast(error.code === "23505"
      ? "Questo username è già utilizzato. Scegline un altro."
      : "Errore profilo: " + error.message);
    return;
  }

  profile.display_name = display_name;
  profile.username = username;
  profile.bio = bio;

  renderProfile();
  $("#profileDialog").close();
  toast("Profilo aggiornato!");
});

function openCompose() {
  $("#postText").value = "";
  $("#composeDialog").showModal();
}
$("#newPostTop").onclick = openCompose;
$("#navCreate").onclick = openCompose;
$("#composerShortcut").onclick = openCompose;
document.querySelectorAll("[data-open-compose]").forEach(b => b.onclick = openCompose);
$("#photoShortcut").onclick = e => { e.stopPropagation(); toast("Foto e video saranno aggiunti nella prossima fase."); };
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());

document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $("#" + b.dataset.view).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("selected", n === b));
}));

$("#stories").innerHTML = [["＋","La tua storia","add"],["LU","Storie",""],["MA","Storie",""],["AL","Storie",""]]
  .map(([t,n,c]) => `<div class="story ${c}"><div class="story-ring"><div>${t}</div></div>${n}</div>`).join("");

$("#logoutButton")?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  location.reload();
});

supabaseClient.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => bootstrap(session), 0);
});

(async () => {
  if (!window.supabase || !window.FAST_SWIM_CONFIG?.supabaseUrl || !window.FAST_SWIM_CONFIG?.supabasePublishableKey) {
    setAuthMessage("Configurazione Supabase mancante. Controlla il file config.js.");
    return;
  }
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) setAuthMessage("Errore di connessione: " + error.message);
  else await bootstrap(data.session);
})();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
