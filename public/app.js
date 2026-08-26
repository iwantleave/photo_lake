(function () {
  function fmtSize(b) {
    if (b == null) return '-';
    b = +b;
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = Math.floor(Math.log(b) / Math.log(1024));
    if (i < 0) i = 0;
    i = Math.min(i, u.length - 1);
    return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
  }
  function fmtDur(s) {
    if (s == null) return '-';
    s = +s;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function api(url) {
    return fetch(url).then((r) => r.json());
  }
  function toast(msg) {
    let t = document.getElementById('__toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '__toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }
  function copyPath(p) {
    navigator.clipboard.writeText(p).then(() => toast('已复制路径'));
  }

  // ---------------- 媒体页 ----------------
  if (document.getElementById('media-body')) initMedia();
  function initMedia() {
    let page = 1,
      sort = 'taken_at',
      order = 'desc';
    const body = document.getElementById('media-body');
    const meta = document.getElementById('table-meta');
    const pageinfo = document.getElementById('pageinfo');

    api('/api/media/facets').then((f) => {
      fillSelect(document.getElementById('f-folder'), f.folders.map((x) => ({ v: x.id, t: x.alias || x.path })));
      fillSelect(document.getElementById('f-format'), f.formats.map((x) => ({ v: x, t: x })));
      fillSelect(document.getElementById('f-make'), f.makes.map((x) => ({ v: x, t: x })), true);
      fillSelect(document.getElementById('f-model'), f.models.map((x) => ({ v: x, t: x })), true);
    });

    function fillSelect(sel, opts, withEmpty) {
      sel.innerHTML = '';
      if (withEmpty) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = sel.id === 'f-make' ? '厂商:全部' : '型号:全部';
        sel.appendChild(o);
      }
      opts.forEach((o) => {
        const e = document.createElement('option');
        e.value = o.v;
        e.textContent = o.t;
        sel.appendChild(e);
      });
    }
    function multiVal(id) {
      const s = document.getElementById(id);
      return [...s.selectedOptions].map((o) => o.value).filter(Boolean).join(',');
    }
    function collect() {
      const p = new URLSearchParams();
      const q = document.getElementById('f-q').value.trim();
      if (q) p.set('q', q);
      const t = document.getElementById('f-type').value;
      if (t) p.set('media_type', t);
      const fld = multiVal('f-folder');
      if (fld) p.set('folder_ids', fld);
      const fmt = multiVal('f-format');
      if (fmt) p.set('formats', fmt);
      const tf = document.getElementById('f-tfrom').value;
      if (tf) p.set('taken_from', tf);
      const tt = document.getElementById('f-tto').value;
      if (tt) p.set('taken_to', tt);
      const mp = document.getElementById('f-mp').value;
      if (mp) {
        const [a, b] = mp.split(',');
        p.set('mp_min', a);
        p.set('mp_max', b);
      }
      const mk = document.getElementById('f-make').value;
      if (mk) p.set('camera_makes', mk);
      const md = document.getElementById('f-model').value;
      if (md) p.set('camera_models', md);
      const iso = document.getElementById('f-iso').value;
      if (iso) p.set('iso_min', iso);
      const fo = document.getElementById('f-focal').value;
      if (fo) p.set('focal_min', fo);
      const g = document.getElementById('f-gps').value;
      if (g) p.set('has_gps', g);
      const sm = document.getElementById('f-smin').value;
      if (sm) p.set('size_min', Math.round(+sm * 1048576));
      const sx = document.getElementById('f-smax').value;
      if (sx) p.set('size_max', Math.round(+sx * 1048576));
      const dm = document.getElementById('f-dmin').value;
      if (dm) p.set('dur_min', dm);
      const dx = document.getElementById('f-dmax').value;
      if (dx) p.set('dur_max', dx);
      const st = multiVal('f-status');
      if (st) p.set('statuses', st);
      if (document.getElementById('f-live').checked) p.set('live_only', '1');
      if (document.getElementById('f-dup').checked) p.set('dup_only', '1');
      if (document.getElementById('f-notime').checked) p.set('no_time', '1');
      p.set('sort', sort);
      p.set('order', order);
      p.set('page', page);
      p.set('pageSize', document.getElementById('pagesize').value);
      return p;
    }
    function load() {
      const p = collect();
      api('/api/media?' + p.toString()).then((d) => {
        body.innerHTML = d.rows.map(rowHtml).join('');
        const total = d.total,
          ps = d.pageSize,
          pages = Math.max(1, Math.ceil(total / ps));
        pageinfo.textContent = `第 ${d.page}/${pages} 页，共 ${total} 条`;
        meta.textContent = `排序：${d.sort} ${d.order}　每页 ${ps}`;
      });
    }
    function rowHtml(r) {
      const live = r.is_livephoto ? ' <span class="badge live">实况</span>' : '';
      const res = r.width && r.height ? r.width + '×' + r.height : '-';
      let status = '';
      if (r.is_missing)
        status =
          '<span class="badge missing">missing</span>' +
          (r.missing_since ? '<span class="muted"> 自' + r.missing_since.slice(0, 10) + '起丢失</span>' : '');
      else status = '<span class="badge ' + r.scan_status + '">' + r.scan_status + '</span>';
      return (
        '<tr>' +
        '<td>' + esc(r.file_name) + live + '</td>' +
        '<td>' + (r.media_type === 'video' ? '🎬视频' : '🖼图片') + '</td>' +
        '<td class="path-cell">' + esc(r.dir_path) + '</td>' +
        '<td>' + (r.taken_at ? r.taken_at.slice(0, 16).replace('T', ' ') : '-') + '</td>' +
        '<td>' + esc(r.format) + '</td>' +
        '<td>' + res + '</td>' +
        '<td>' + fmtDur(r.duration) + '</td>' +
        '<td>' + fmtSize(r.file_size) + '</td>' +
        '<td>' + status + '</td>' +
        '<td></td>' +
        '<td class="ops"><button class="btn-sm copy-btn" data-path="' + esc(r.file_path) + '">复制路径</button></td>' +
        '</tr>'
      );
    }

    body.addEventListener('click', (e) => {
      const b = e.target.closest('.copy-btn');
      if (b) copyPath(b.dataset.path);
    });
    document.getElementById('btn-query').addEventListener('click', () => {
      page = 1;
      load();
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      document.querySelectorAll('.filter-body input, .filter-body select').forEach((el) => {
        if (el.type === 'checkbox') el.checked = false;
        else if (el.multiple) el.selectedIndex = -1;
        else el.value = '';
      });
      page = 1;
      load();
    });
    document.getElementById('prev').addEventListener('click', () => {
      if (page > 1) {
        page--;
        load();
      }
    });
    document.getElementById('next').addEventListener('click', () => {
      page++;
      load();
    });
    document.getElementById('pagesize').addEventListener('change', () => {
      page = 1;
      load();
    });
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const s = th.dataset.sort;
        if (sort === s) order = order === 'asc' ? 'desc' : 'asc';
        else {
          sort = s;
          order = 'desc';
        }
        load();
      });
    });

    const up = new URLSearchParams(location.search);
    if (up.has('md5')) document.getElementById('f-q').value = 'md5:' + up.get('md5');
    if (up.has('q')) document.getElementById('f-q').value = up.get('q');
    load();
  }

  // ---------------- 重复页 ----------------
  if (document.getElementById('dup-body')) initDup();
  function initDup() {
    const body = document.getElementById('dup-body');
    api('/api/media/duplicates').then((d) => {
      if (!d.groups.length) {
        body.innerHTML = '<p class="muted">没有发现重复文件。</p>';
        return;
      }
      let html = '';
      d.groups.forEach((g) => {
        const keep = Math.min.apply(null, g.members.map((m) => m.file_size));
        const waste = fmtSize(g.total_size - keep);
        html +=
          '<div class="dup-group"><div class="dup-head">MD5 ' +
          esc(g.md5) +
          ' ｜ ' +
          g.cnt +
          ' 个文件 ｜ 浪费 ' +
          waste +
          '</div><ul>' +
          g.members
            .map(
              (m) =>
                '<li>' +
                (m.media_type === 'video' ? '🎬' : '🖼') +
                ' ' +
                esc(m.file_path) +
                ' <span class="muted">(' +
                fmtSize(m.file_size) +
                ')</span>' +
                (m.is_missing ? '<span class="badge missing">missing</span>' : '') +
                '</li>'
            )
            .join('') +
          '</ul></div>';
      });
      body.innerHTML = html;
    });
  }

  // ---------------- 任务页 ----------------
  if (document.getElementById('job-body')) initJobs();
  function initJobs() {
    const body = document.getElementById('job-body');
    let timer = null;
    function load() {
      api('/api/jobs').then((d) => {
        body.innerHTML = d.jobs
          .map(
            (j) =>
              '<tr><td>#' +
              j.id +
              '</td><td>文件夹#' +
              j.folder_id +
              '</td><td><span class="badge ' +
              j.status +
              '">' +
              j.status +
              '</span></td><td>' +
              j.processed +
              ' / ' +
              j.total_count +
              '</td><td>' +
              j.added +
              '/' +
              j.updated +
              '/' +
              j.failed +
              '</td><td>' +
              (j.started_at ? j.started_at.slice(0, 19).replace('T', ' ') : '-') +
              '</td><td>' +
              (j.finished_at ? j.finished_at.slice(0, 19).replace('T', ' ') : '-') +
              '</td><td class="ops">' +
              (j.status === 'running' ? '<button class="btn-sm danger" onclick="cancelJob(' + j.id + ')">取消</button>' : '') +
              '</td></tr>'
          )
          .join('');
        const running = d.jobs.some((j) => j.status === 'running');
        if (running && !timer) timer = setInterval(load, 1500);
        if (!running && timer) {
          clearInterval(timer);
          timer = null;
        }
      });
    }
    window.cancelJob = function (id) {
      fetch('/api/jobs/' + id + '/cancel', { method: 'POST' }).then(load);
    };
    load();
  }
})();
