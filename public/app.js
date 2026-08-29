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

  // ---------------- 详情弹窗（媒体页 / 重复页共用）----------------
  let __detailMask = null;

  function dvRaw(v) {
    if (v === null || v === undefined || v === '') return '<span class="dv-empty">—</span>';
    return esc(v);
  }
  function dvRow(k, v) {
    return '<div class="dv-row"><div class="dv-k">' + esc(k) + '</div><div class="dv-v">' + v + '</div></div>';
  }
  function dvGroup(title, rows) {
    const has = rows.some((r) => r.indexOf('dv-empty') === -1);
    return (
      '<div class="dv-group' + (has ? '' : ' dv-group-empty') + '">' +
      '<div class="dv-gtitle">' + esc(title) + '</div>' +
      rows.join('') +
      '</div>'
    );
  }
  function dvBool(v) {
    return v ? '<span class="badge ok">是</span>' : '<span class="badge">否</span>';
  }
  function dvTime(t) {
    return t ? '<span class="mono">' + esc(String(t).slice(0, 19).replace('T', ' ')) + '</span>' : '<span class="dv-empty">—</span>';
  }

  function detailHtml(m, folder) {
    const isVideo = m.media_type === 'video';
    const res = m.width && m.height ? m.width + ' × ' + m.height : null;
    const g = [];

    g.push(
      dvGroup('基础信息', [
        dvRow('文件名', '<span class="mono wrap">' + esc(m.file_name) + '</span>'),
        dvRow('媒体类型', isVideo ? '🎬 视频' : '🖼 图片'),
        dvRow('格式', '<span class="dv-tag">' + esc(m.format) + '</span>'),
        dvRow('来源文件夹', folder ? esc(folder.alias || folder.path) : '<span class="dv-empty">—</span>'),
        dvRow('所在目录', '<span class="mono wrap">' + esc(m.dir_path) + '</span>'),
        dvRow('完整路径', '<span class="mono wrap">' + esc(m.file_path) + '</span>'),
        dvRow('文件大小', fmtSize(m.file_size)),
        dvRow('文件修改时间', dvTime(m.mtime))
      ])
    );

    g.push(
      dvGroup('拍摄时间', [
        dvRow('拍摄时间', dvTime(m.taken_at)),
        dvRow(
          '时间来源',
          m.taken_at_source === 'exif'
            ? '<span class="badge ok">EXIF</span>'
            : m.taken_at_source === 'ffprobe'
            ? '<span class="badge scanning">ffprobe</span>'
            : '<span class="badge degraded">文件修改时间</span>'
        )
      ])
    );

    const mediaRows = [dvRow('分辨率', res ? '<span class="mono">' + esc(res) + '</span>' : '<span class="dv-empty">—</span>')];
    if (m.megapixel != null) mediaRows.push(dvRow('像素', m.megapixel.toFixed(2) + ' MP'));
    if (isVideo) {
      mediaRows.push(dvRow('时长', m.duration != null ? fmtDur(m.duration) : '<span class="dv-empty">—</span>'));
      mediaRows.push(dvRow('视频编码', m.codec ? '<span class="dv-tag">' + esc(m.codec) + '</span>' : '<span class="dv-empty">—</span>'));
    }
    g.push(dvGroup(isVideo ? '视频参数' : '图像参数', mediaRows));

    g.push(
      dvGroup('拍摄参数（EXIF）', [
        dvRow('相机厂商', dvRaw(m.camera_make)),
        dvRow('相机型号', dvRaw(m.camera_model)),
        dvRow('镜头型号', dvRaw(m.lens_model)),
        dvRow('光圈', m.f_number != null ? 'f/' + m.f_number : '<span class="dv-empty">—</span>'),
        dvRow('快门速度', m.exposure_time ? esc(m.exposure_time) + ' s' : '<span class="dv-empty">—</span>'),
        dvRow('ISO', m.iso != null ? '<span class="mono">' + m.iso + '</span>' : '<span class="dv-empty">—</span>'),
        dvRow('焦距', m.focal_length != null ? m.focal_length + ' mm' : '<span class="dv-empty">—</span>'),
        dvRow('方向', m.orientation != null ? m.orientation : '<span class="dv-empty">—</span>')
      ])
    );

    const hasGps = m.gps_lat != null && m.gps_lon != null;
    g.push(
      dvGroup(
        '位置信息',
        [
          dvRow('纬度', m.gps_lat != null ? '<span class="mono">' + m.gps_lat + '</span>' : '<span class="dv-empty">—</span>'),
          dvRow('经度', m.gps_lon != null ? '<span class="mono">' + m.gps_lon + '</span>' : '<span class="dv-empty">—</span>'),
          dvRow('海拔', m.gps_alt != null ? m.gps_alt + ' m' : '<span class="dv-empty">—</span>')
        ].concat(
          hasGps
            ? [dvRow('地图', '<a class="dv-link" href="https://www.openstreetmap.org/?mlat=' + m.gps_lat + '&mlon=' + m.gps_lon + '#map=15/' + m.gps_lat + '/' + m.gps_lon + '" target="_blank" rel="noopener">在 OpenStreetMap 查看</a>')]
            : []
        )
      )
    );

    const statusRows = [
      dvRow(
        '扫描状态',
        m.is_missing
          ? '<span class="badge missing">文件丢失</span>'
          : '<span class="badge ' + esc(m.scan_status) + '">' + esc(m.scan_status) + '</span>'
      ),
      dvRow('MD5', m.md5 ? '<span class="mono wrap">' + esc(m.md5) + '</span>' : '<span class="dv-empty">无（视频 MD5 已关闭）</span>')
    ];
    if (m.fail_reason) statusRows.push(dvRow('失败原因', esc(m.fail_reason)));
    statusRows.push(dvRow('文件丢失', dvBool(m.is_missing)));
    if (m.is_missing) statusRows.push(dvRow('丢失发现于', dvTime(m.missing_since)));
    statusRows.push(dvRow('实况照片', m.is_livephoto ? '<span class="badge live">实况</span>' : '<span class="badge">否</span>'));
    statusRows.push(dvRow('用户标记', dvBool(m.marked)));
    g.push(dvGroup('校验与状态', statusRows));

    g.push(
      dvGroup('系统字段', [
        dvRow('记录 ID', '<span class="mono">#' + m.id + '</span>'),
        dvRow('入库时间', dvTime(m.gmt_create)),
        dvRow('更新时间', dvTime(m.gmt_modified))
      ])
    );

    let raw = '';
    if (m.raw_metadata) {
      let pretty = m.raw_metadata;
      try {
        pretty = JSON.stringify(JSON.parse(m.raw_metadata), null, 2);
      } catch (e) {
        /* 非合法 JSON 时按原文展示 */
      }
      raw =
        '<div class="dv-group"><div class="dv-gtitle">原始元数据（raw_metadata）</div>' +
        '<details class="dv-raw"><summary>展开 JSON（' + m.raw_metadata.length + ' 字符）</summary>' +
        '<pre class="dv-pre">' + esc(pretty) + '</pre></details></div>';
    }

    return (
      '<div class="modal-head">' +
      '<div class="modal-title">' +
      (isVideo ? '🎬 ' : '🖼 ') + esc(m.file_name) +
      '<span class="modal-id">#' + m.id + '</span>' +
      '</div>' +
      '<button class="modal-close" type="button" aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="modal-body">' + g.join('') + raw + '</div>' +
      '<div class="modal-foot">' +
      '<button class="btn-sm" data-copy="' + esc(m.file_path) + '">复制完整路径</button>' +
      '<button class="btn-sm" data-copy="' + esc(m.dir_path) + '">复制所在目录</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn ghost modal-close">关闭</button>' +
      '</div>'
    );
  }

  function ensureDetailMask() {
    if (__detailMask) return __detailMask;
    __detailMask = document.createElement('div');
    __detailMask.className = 'modal-mask';
    __detailMask.id = 'detail-mask';
    document.body.appendChild(__detailMask);

    __detailMask.addEventListener('click', (e) => {
      if (e.target === __detailMask) return closeDetail();
      if (e.target.closest('.modal-close')) return closeDetail();
      const c = e.target.closest('[data-copy]');
      if (c) copyPath(c.dataset.copy);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && __detailMask.classList.contains('show')) closeDetail();
    });
    return __detailMask;
  }

  function closeDetail() {
    if (__detailMask) __detailMask.classList.remove('show');
  }

  function openDetail(id) {
    const mask = ensureDetailMask();
    mask.innerHTML = '<div class="modal"><div class="modal-loading">加载中…</div></div>';
    mask.classList.add('show');
    api('/api/media/' + id)
      .then((d) => {
        if (!d || d.error) {
          mask.innerHTML = '<div class="modal"><div class="modal-loading">加载失败：' + esc((d && d.error) || '未知错误') + '</div></div>';
          return;
        }
        mask.innerHTML = '<div class="modal">' + detailHtml(d.media, d.folder) + '</div>';
      })
      .catch(() => {
        mask.innerHTML = '<div class="modal"><div class="modal-loading">加载失败，请检查服务是否运行</div></div>';
      });
  }
  window.openDetail = openDetail;

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
        '<td class="ops">' +
          '<button class="btn-sm detail-btn" data-id="' + r.id + '">详情</button>' +
          '<button class="btn-sm copy-btn" data-path="' + esc(r.file_path) + '">复制路径</button>' +
        '</td>' +
        '</tr>'
      );
    }

    body.addEventListener('click', (e) => {
      const d = e.target.closest('.detail-btn');
      if (d) {
        openDetail(d.dataset.id);
        return;
      }
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
    body.addEventListener('click', (e) => {
      const b = e.target.closest('.detail-btn');
      if (b) openDetail(b.dataset.id);
    });
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
                ' <button class="btn-sm detail-btn" data-id="' + m.id + '">详情</button>' +
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
