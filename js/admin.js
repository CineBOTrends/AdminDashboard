(function () {
  "use strict";

  /* ============================================================
     CONFIG — must mirror datacollector/build_data.py build_editorial()
     ============================================================ */
  var TYPES = {
    boxoffice: {
      label: "Box Office Updates",
      folder: "boxoffice",
      workflow: "combine.yml",
      titleField: "title",
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "movie", label: "Movie", type: "text" },
        { key: "reportType", label: "Report type", type: "text", placeholder: "e.g. Day 1, Weekend, Overseas" },
        { key: "date", label: "Date", type: "date", required: true },
        { key: "image", label: "Image URL", type: "url" },
        { key: "slug", label: "Slug", type: "text", placeholder: "auto-generated from title if left blank" },
        { key: "body", label: "Body", type: "textarea", placeholder: "Separate paragraphs with a blank line." },
      ],
    },
    news: {
      label: "Movie News",
      folder: "news",
      workflow: "combine.yml",
      titleField: "title",
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "date", label: "Date", type: "date", required: true },
        { key: "image", label: "Image URL", type: "url" },
        { key: "summary", label: "Summary (shown in list card)", type: "text" },
        { key: "slug", label: "Slug", type: "text", placeholder: "auto-generated from title if left blank" },
        { key: "body", label: "Body", type: "textarea", placeholder: "Separate paragraphs with a blank line." },
      ],
    },
    reviews: {
      label: "Movie Reviews",
      folder: "reviews",
      workflow: "combine.yml",
      titleField: "movie",
      fields: [
        { key: "movie", label: "Movie", type: "text", required: true },
        { key: "rating", label: "Rating (0-5)", type: "number", step: "0.5", min: "0", max: "5" },
        { key: "date", label: "Date", type: "date", required: true },
        { key: "poster", label: "Poster URL", type: "url" },
        { key: "summary", label: "Summary (shown in list card)", type: "text" },
        { key: "slug", label: "Slug", type: "text", placeholder: "auto-generated from movie name if left blank" },
        { key: "body", label: "Review body", type: "textarea", placeholder: "Separate paragraphs with a blank line." },
      ],
    },
  };
  var TAB_ORDER = ["boxoffice", "news", "reviews"];

  var CFG_KEY = "cbo_admin_config_v1";

  var state = {
    token: "",
    owner: "CineBOTrends",
    repo: "datacollector",
    branch: "main",
    tab: "boxoffice",
    posts: {}, // type -> array of {fields, body, path, sha}
    loaded: {}, // type -> bool
  };

  /* ============================================================
     Frontmatter (mirrors _parse_frontmatter / build_editorial in
     datacollector/build_data.py exactly, so posts saved here parse
     the same way the publish pipeline reads them)
     ============================================================ */
  function parseFrontmatter(text) {
    text = String(text || "").replace(/\r\n/g, "\n");
    var fields = {};
    var body = text;
    if (text.indexOf("---") === 0) {
      var end = text.indexOf("\n---", 3);
      if (end !== -1) {
        var fm = text.slice(3, end).replace(/^\n+|\n+$/g, "");
        body = text.slice(end + 4).replace(/^\n+/, "");
        fm.split("\n").forEach(function (line) {
          if (!line.trim() || line.indexOf(":") === -1) return;
          var idx = line.indexOf(":");
          var key = line.slice(0, idx).trim();
          var val = line.slice(idx + 1).trim();
          if (
            (val[0] === '"' && val[val.length - 1] === '"') ||
            (val[0] === "'" && val[val.length - 1] === "'")
          ) {
            val = val.slice(1, -1);
          }
          if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
          else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
          fields[key] = val;
        });
      }
    }
    return { fields: fields, body: body.trim() };
  }

  function yamlScalar(key, v) {
    if (key === "rating" && typeof v === "number") return String(v);
    var s = String(v).replace(/\r?\n/g, " ").trim();
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  function buildMarkdown(type, values) {
    var cfg = TYPES[type];
    var lines = ["---"];
    cfg.fields.forEach(function (f) {
      if (f.key === "body") return;
      var v = values[f.key];
      if (f.key === "rating" && v !== undefined && v !== null && v !== "") {
        v = parseFloat(v);
      }
      if (v === undefined || v === null || v === "") return;
      lines.push(f.key + ": " + yamlScalar(f.key, v));
    });
    lines.push("---");
    var body = String(values.body || "").replace(/\r\n/g, "\n").trim();
    return lines.join("\n") + "\n\n" + body + "\n";
  }

  function slugify(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  /* ============================================================
     Base64 helpers (UTF-8 safe)
     ============================================================ */
  function b64Encode(str) {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (_, p1) {
        return String.fromCharCode(parseInt(p1, 16));
      }),
    );
  }
  function b64Decode(str) {
    return decodeURIComponent(
      atob(str.replace(/\n/g, ""))
        .split("")
        .map(function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );
  }

  /* ============================================================
     GitHub REST API
     ============================================================ */
  var API = "https://api.github.com";

  function ghHeaders() {
    return {
      Authorization: "Bearer " + state.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  function ghRequest(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, ghHeaders(), opts.headers || {});
    return fetch(API + path, Object.assign({}, opts, { headers: headers })).then(function (res) {
      if (res.status === 204) return null;
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (j) {
            var err = new Error("GitHub API " + res.status + ": " + (j.message || res.statusText));
            err.status = res.status;
            throw err;
          });
      }
      return res.json();
    });
  }

  function contentsPath(p) {
    return "/repos/" + state.owner + "/" + state.repo + "/contents/" + p;
  }

  function verifyRepoAccess() {
    return ghRequest("/repos/" + state.owner + "/" + state.repo);
  }

  function listFolder(folder) {
    return ghRequest(contentsPath(folder) + "?ref=" + encodeURIComponent(state.branch))
      .then(function (items) {
        return (items || []).filter(function (i) {
          return i.type === "file" && /\.md$/i.test(i.name);
        });
      })
      .catch(function (e) {
        if (e.status === 404) return [];
        throw e;
      });
  }

  function getFile(path) {
    return ghRequest(contentsPath(path) + "?ref=" + encodeURIComponent(state.branch)).then(function (data) {
      return { sha: data.sha, text: b64Decode(data.content) };
    });
  }

  function putFile(path, text, message, sha) {
    var body = { message: message, content: b64Encode(text), branch: state.branch };
    if (sha) body.sha = sha;
    return ghRequest(contentsPath(path), { method: "PUT", body: JSON.stringify(body) });
  }

  function deleteFile(path, message, sha) {
    return ghRequest(contentsPath(path), {
      method: "DELETE",
      body: JSON.stringify({ message: message, sha: sha, branch: state.branch }),
    });
  }

  function dispatchWorkflow(workflowFile) {
    return ghRequest(
      "/repos/" + state.owner + "/" + state.repo + "/actions/workflows/" + workflowFile + "/dispatches",
      { method: "POST", body: JSON.stringify({ ref: state.branch }) },
    );
  }

  /* ============================================================
     DOM helpers
     ============================================================ */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
        node.addEventListener(k.slice(2), attrs[k]);
      } else node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null) continue;
      if (Array.isArray(child)) child.forEach(function (c) {
        if (c != null) node.appendChild(c);
      });
      else if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  var app = document.getElementById("app");
  function mount(node) {
    app.innerHTML = "";
    app.appendChild(node);
  }

  function toast(message, kind) {
    var stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = el("div", { class: "toast-stack" });
      document.body.appendChild(stack);
    }
    var t = el("div", { class: "toast" + (kind ? " " + kind : "") }, message);
    stack.appendChild(t);
    setTimeout(function () {
      t.remove();
    }, 5000);
  }

  /* ============================================================
     Persisted config
     ============================================================ */
  function loadConfig() {
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (!raw) return;
      var cfg = JSON.parse(raw);
      Object.assign(state, cfg);
    } catch (e) {}
  }
  function saveConfig() {
    localStorage.setItem(
      CFG_KEY,
      JSON.stringify({ token: state.token, owner: state.owner, repo: state.repo, branch: state.branch }),
    );
  }
  function clearConfig() {
    localStorage.removeItem(CFG_KEY);
    state.token = "";
  }

  /* ============================================================
     Connect screen
     ============================================================ */
  function renderConnect(errorMsg) {
    var tokenInput, ownerInput, repoInput, branchInput;
    var card = el(
      "div",
      { class: "connect-card" },
      el("h1", null, "Connect to GitHub"),
      el(
        "p",
        { class: "lead" },
        "This admin panel posts Box Office Updates, Movie News, and Movie Reviews as content files " +
          "into the datacollector repo. The existing publish pipeline turns them into the live site's " +
          "data automatically.",
      ),
      errorMsg ? el("div", { class: "error-box" }, errorMsg) : null,
      el(
        "div",
        { class: "field" },
        el("label", null, "Personal access token"),
        (tokenInput = el("input", { type: "password", placeholder: "github_pat_..." })),
        el(
          "div",
          { class: "hint" },
          "Fine-grained token scoped to this one repo, with Contents: Read & write " +
            "(and Actions: Read & write if you want the Publish now button). Stored only in this browser's localStorage.",
        ),
      ),
      el(
        "div",
        { class: "row" },
        el(
          "div",
          { class: "field" },
          el("label", null, "Owner"),
          (ownerInput = el("input", { type: "text", value: state.owner })),
        ),
        el(
          "div",
          { class: "field" },
          el("label", null, "Repo"),
          (repoInput = el("input", { type: "text", value: state.repo })),
        ),
        el(
          "div",
          { class: "field" },
          el("label", null, "Branch"),
          (branchInput = el("input", { type: "text", value: state.branch })),
        ),
      ),
      el(
        "div",
        { class: "form-actions" },
        el(
          "button",
          {
            class: "primary",
            onclick: function () {
              var btn = this;
              state.token = tokenInput.value.trim();
              state.owner = ownerInput.value.trim() || "CineBOTrends";
              state.repo = repoInput.value.trim() || "datacollector";
              state.branch = branchInput.value.trim() || "main";
              if (!state.token) {
                renderConnect("Enter a personal access token first.");
                return;
              }
              btn.disabled = true;
              btn.textContent = "Connecting…";
              verifyRepoAccess()
                .then(function () {
                  saveConfig();
                  renderMain();
                })
                .catch(function (e) {
                  renderConnect(e.message || "Could not access that repo with this token.");
                });
            },
          },
          "Connect",
        ),
      ),
      el(
        "p",
        { class: "footnote" },
        "Need a token? GitHub → Settings → Developer settings → Personal access tokens → " +
          "Fine-grained tokens → generate one limited to the “" +
          state.repo +
          "” repository only, with an expiration date.",
      ),
    );
    mount(el("div", { class: "connect-wrap" }, card));
  }

  /* ============================================================
     Main app shell
     ============================================================ */
  function renderMain() {
    var shell = el(
      "div",
      null,
      el(
        "div",
        { class: "topbar" },
        el(
          "div",
          { class: "brand" },
          el("span", { class: "cine" }, "Cine"),
          "BOTrends",
          el("span", { class: "tag" }, "ADMIN"),
        ),
        el(
          "div",
          { class: "conn" },
          el("span", { class: "dot" }),
          el("span", null, "Connected to "),
          el("code", null, state.owner + "/" + state.repo + "@" + state.branch),
          el(
            "button",
            {
              class: "settings-link",
              onclick: function () {
                clearConfig();
                renderConnect();
              },
            },
            "disconnect",
          ),
          el(
            "button",
            {
              class: "settings-link",
              onclick: function () {
                fetch("/api/logout", { method: "POST" }).finally(function () {
                  location.href = "/login.html";
                });
              },
            },
            "log out",
          ),
        ),
      ),
      el("div", { class: "main", id: "main" }),
    );
    mount(shell);
    renderTabs();
  }

  function renderTabs() {
    var main = document.getElementById("main");
    main.innerHTML = "";
    var tabsEl = el(
      "div",
      { class: "tabs" },
      TAB_ORDER.map(function (type) {
        var cfg = TYPES[type];
        var t = el(
          "div",
          { class: "tab" + (state.tab === type ? " active" : "") },
          cfg.label,
          el("span", { class: "count" }, state.posts[type] ? "" + state.posts[type].length : ""),
        );
        t.addEventListener("click", function () {
          state.tab = type;
          renderTabs();
        });
        return t;
      }),
    );
    main.appendChild(tabsEl);
    var panel = el("div", { id: "panel" });
    main.appendChild(panel);
    renderListPanel(state.tab);
  }

  /* ============================================================
     List panel
     ============================================================ */
  function renderListPanel(type) {
    var cfg = TYPES[type];
    var panel = document.getElementById("panel");
    panel.innerHTML = "";

    panel.appendChild(
      el(
        "div",
        { class: "panel-head" },
        el(
          "div",
          null,
          el("h2", null, cfg.label),
          el("p", null, "Writes to content/" + cfg.folder + "/*.md in the datacollector repo."),
        ),
        el(
          "button",
          {
            class: "primary",
            onclick: function () {
              renderForm(type, null);
            },
          },
          "+ New",
        ),
      ),
    );

    if (state.pendingPublish) {
      panel.appendChild(
        el(
          "div",
          { class: "publish-banner" },
          el(
            "p",
            null,
            "Changes are committed. They go live on the next scheduled scrape, or click Publish now to trigger it immediately.",
          ),
          el("span", { class: "spacer" }),
          el(
            "button",
            {
              onclick: function () {
                var btn = this;
                btn.disabled = true;
                btn.textContent = "Triggering…";
                dispatchWorkflow(cfg.workflow)
                  .then(function () {
                    toast("Publish workflow triggered on GitHub Actions.", "success");
                    state.pendingPublish = false;
                    renderListPanel(type);
                  })
                  .catch(function (e) {
                    toast(e.message, "error");
                    btn.disabled = false;
                    btn.textContent = "Publish now";
                  });
              },
            },
            "Publish now",
          ),
        ),
      );
    }

    var listWrap = el("div", { class: "loading" }, "Loading…");
    panel.appendChild(listWrap);

    loadType(type).then(function (posts) {
      listWrap.remove();
      if (!posts.length) {
        panel.appendChild(el("div", { class: "empty" }, "No " + cfg.label.toLowerCase() + " posted yet."));
        return;
      }
      var sorted = posts.slice().sort(function (a, b) {
        return String(b.fields.date || "").localeCompare(String(a.fields.date || ""));
      });
      var list = el(
        "div",
        { class: "list" },
        sorted.map(function (post) {
          return renderPostCard(type, post);
        }),
      );
      panel.appendChild(list);
    }).catch(function (e) {
      listWrap.remove();
      panel.appendChild(el("div", { class: "error-box" }, e.message));
    });
  }

  function renderPostCard(type, post) {
    var cfg = TYPES[type];
    var f = post.fields;
    var img = f.image || f.poster;
    var titleText = f[cfg.titleField] || f.title || f.movie || "Untitled";
    var metaBits = [f.date || ""];
    if (type === "reviews" && f.rating != null) metaBits.push("★ " + f.rating + "/5");
    if (type === "boxoffice" && f.reportType) metaBits.push(f.reportType);

    return el(
      "div",
      { class: "post-card" },
      img ? el("div", { class: "thumb", style: "background-image:url('" + img + "')" }) : el("div", { class: "thumb" }),
      el(
        "div",
        { class: "info" },
        el("div", { class: "title" }, titleText),
        el("div", { class: "meta" }, metaBits.filter(Boolean).join("  ·  ")),
      ),
      el(
        "div",
        { class: "actions" },
        el(
          "button",
          {
            onclick: function () {
              renderForm(type, post);
            },
          },
          "Edit",
        ),
        el(
          "button",
          {
            class: "danger",
            onclick: function () {
              if (!confirm('Delete "' + titleText + '"? This cannot be undone.')) return;
              deleteFile(post.path, "content: delete " + type + "/" + f.slug, post.sha)
                .then(function () {
                  state.posts[type] = state.posts[type].filter(function (p) {
                    return p.path !== post.path;
                  });
                  state.pendingPublish = true;
                  toast("Deleted.", "success");
                  renderListPanel(type);
                })
                .catch(function (e) {
                  toast(e.message, "error");
                });
            },
          },
          "Delete",
        ),
      ),
    );
  }

  function loadType(type) {
    if (state.loaded[type]) return Promise.resolve(state.posts[type]);
    var cfg = TYPES[type];
    return listFolder("content/" + cfg.folder).then(function (files) {
      return Promise.all(
        files.map(function (file) {
          return getFile(file.path).then(function (loaded) {
            var parsed = parseFrontmatter(loaded.text);
            var fields = parsed.fields;
            fields.body = parsed.body;
            if (!fields.slug) fields.slug = file.name.replace(/\.md$/i, "");
            return { fields: fields, path: file.path, sha: loaded.sha };
          });
        }),
      ).then(function (posts) {
        state.posts[type] = posts;
        state.loaded[type] = true;
        return posts;
      });
    });
  }

  /* ============================================================
     Create / edit form
     ============================================================ */
  function renderForm(type, existing) {
    var cfg = TYPES[type];
    var panel = document.getElementById("panel");
    panel.innerHTML = "";
    var inputs = {};
    var values = existing ? existing.fields : {};

    panel.appendChild(
      el(
        "div",
        { class: "panel-head" },
        el("h2", null, existing ? "Edit " + cfg.label.replace(/s$/, "") : "New " + cfg.label.replace(/s$/, "")),
      ),
    );

    var formCard = el("div", { class: "form-card" });
    cfg.fields.forEach(function (f) {
      var input;
      if (f.type === "textarea") {
        input = el("textarea", { placeholder: f.placeholder || "" });
        input.value = values[f.key] || "";
      } else {
        var attrs = { type: f.type === "url" ? "text" : f.type, placeholder: f.placeholder || "" };
        if (f.step) attrs.step = f.step;
        if (f.min) attrs.min = f.min;
        if (f.max) attrs.max = f.max;
        input = el("input", attrs);
        input.value = values[f.key] != null ? values[f.key] : "";
      }
      inputs[f.key] = input;
      formCard.appendChild(
        el(
          "div",
          { class: "field" },
          el("label", null, f.label + (f.required ? " *" : "")),
          input,
        ),
      );
    });

    formCard.appendChild(
      el(
        "div",
        { class: "form-actions" },
        el(
          "button",
          {
            onclick: function () {
              renderListPanel(type);
            },
          },
          "Cancel",
        ),
        el("span", { class: "spacer" }),
        el(
          "button",
          {
            class: "primary",
            onclick: function () {
              var btn = this;
              var values2 = {};
              cfg.fields.forEach(function (f) {
                values2[f.key] = inputs[f.key].value;
              });
              var missing = cfg.fields.filter(function (f) {
                return f.required && !String(values2[f.key] || "").trim();
              });
              if (missing.length) {
                toast("Fill in: " + missing.map(function (f) { return f.label; }).join(", "), "error");
                return;
              }
              var slug = slugify(values2.slug) || slugify(values2[cfg.titleField]);
              if (!slug) {
                toast("Could not derive a slug — fill in the slug field.", "error");
                return;
              }
              values2.slug = slug;
              var newPath = "content/" + cfg.folder + "/" + slug + ".md";
              var markdown = buildMarkdown(type, values2);
              var isRename = existing && existing.path !== newPath;

              btn.disabled = true;
              btn.textContent = "Saving…";

              var savePromise;
              if (existing && !isRename) {
                savePromise = putFile(newPath, markdown, "content: update " + type + "/" + slug, existing.sha);
              } else if (existing && isRename) {
                savePromise = deleteFile(existing.path, "content: rename " + type + "/" + existing.fields.slug, existing.sha).then(
                  function () {
                    return putFile(newPath, markdown, "content: add " + type + "/" + slug);
                  },
                );
              } else {
                savePromise = putFile(newPath, markdown, "content: add " + type + "/" + slug);
              }

              savePromise
                .then(function () {
                  state.loaded[type] = false; // force refetch so list + shas stay correct
                  state.pendingPublish = true;
                  toast("Saved.", "success");
                  renderListPanel(type);
                })
                .catch(function (e) {
                  toast(e.message, "error");
                  btn.disabled = false;
                  btn.textContent = "Save";
                });
            },
          },
          "Save",
        ),
      ),
    );

    panel.appendChild(formCard);
  }

  /* ============================================================
     Boot
     ============================================================ */
  loadConfig();
  if (state.token) {
    verifyRepoAccess()
      .then(renderMain)
      .catch(function () {
        clearConfig();
        renderConnect("Saved token no longer works — reconnect.");
      });
  } else {
    renderConnect();
  }
})();
