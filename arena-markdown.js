/* Render model text without treating currency as math or accepting raw HTML. */
(function (root) {
  'use strict';
  function escape(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeURL(value) {
    try {
      var url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (_) { return null; }
  }
  function inline(text, depth, options) {
    depth = depth || 0;
    options = options || {};
    if (depth > 4) return escape(text);
    var saved = [];
    function keep(html) { saved.push(html); return '\u0000MD' + (saved.length - 1) + '\u0000'; }
    function format(value) {
      return escape(value)
        .replace(/\*\*\*([^\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^\n]+?)__/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
        .replace(/(^|[\s(（])_([^_\n]+?)_(?=$|[\s.,，。)）])/g, '$1<em>$2</em>')
        .replace(/~~([^\n]+?)~~/g, '<del>$1</del>');
    }
    function restore(value) {
      return value.replace(/\u0000MD(\d+)\u0000/g, function (_, index) { return restore(saved[Number(index)] || ''); });
    }
    var value = String(text).replace(/\u0000/g, '');
    value = value.replace(/(`+)([\s\S]*?)\1(?!`)/g, function (_, ticks, code) {
      return keep('<code>' + escape(code.replace(/\n/g, ' ')) + '</code>');
    });
    value = value.replace(/\\([\\`*{}_\[\]()#+.!|$~>\-])/g, function (_, character) { return keep(escape(character)); });
    value = value.replace(/\[\[aa-citation:(\d+)\]\]/g, function (match, index) {
      var html = options.citation ? options.citation(Number(index)) : '';
      return html ? keep(html) : match;
    });
    value = value.replace(/\[\[(\d+)\]\]\((https?:\/\/[^\s)]+)\)/g, function (match, number, destination) {
      var url = safeURL(destination);
      if (!url) return match;
      var html = options.sourceLink ? options.sourceLink(url, Number(number)) : '';
      return keep(html || '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">[' + number + ']</a>');
    });
    value = value.replace(/\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g, function (match, label, destination) {
      var url = safeURL(destination);
      return url ? keep('<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + format(label) + '</a>') : match;
    });
    value = value.replace(/<?https?:\/\/[^\s<>"'\u0000]+>?/g, function (match) {
      var bare = match.replace(/^</, '').replace(/>$/, '');
      var suffix = '';
      while (/[.,;!?:，。；！？、]$/.test(bare) || (/\)$/.test(bare) && (bare.match(/\)/g) || []).length > (bare.match(/\(/g) || []).length)) {
        suffix = bare.slice(-1) + suffix; bare = bare.slice(0, -1);
      }
      var url = safeURL(bare);
      return url ? keep('<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + escape(bare) + '</a>') + suffix : match;
    });
    return restore(format(value));
  }
  function cells(line) {
    var result = [], cell = '', ticks = 0;
    line = line.trim();
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '\\' && i + 1 < line.length) { cell += ch + line[++i]; continue; }
      if (ch === '`') {
        var end = i; while (line[end + 1] === '`') end++;
        var count = end - i + 1;
        ticks = ticks === count ? 0 : (ticks || count);
        cell += line.slice(i, end + 1); i = end; continue;
      }
      if (ch === '|' && !ticks) { result.push(cell.trim()); cell = ''; }
      else cell += ch;
    }
    result.push(cell.trim());
    if (line[0] === '|') result.shift();
    if (/\|$/.test(line) && !/\\\|$/.test(line)) result.pop();
    return result;
  }
  function separator(line) { return cells(line).length > 1 && cells(line).every(function (cell) { return /^:?-{3,}:?$/.test(cell); }); }
  function listItem(line) { return /^(\s*)([-+*]|\d+[.)])\s+(.+)$/.exec(line); }
  function render(text, options, depth) {
    options = options || {}; depth = depth || 0;
    if (depth > 16) return '<p>' + escape(text) + '</p>';
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var html = '', i = 0;
    function boundary(index) {
      var line = lines[index] || '';
      return !line.trim() || /^\s{0,3}(`{3,}|~{3,}|#{1,6}\s|>|(?:[-*_]\s*){3,}$)/.test(line) || !!listItem(line) || (index + 1 < lines.length && separator(lines[index + 1]) && cells(line).length > 1);
    }
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      var fence = /^\s{0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
      if (fence) {
        var code = [], language = fence[2].trim().split(/\s/)[0].replace(/[^a-zA-Z0-9+#-]/g, '');
        i++;
        while (i < lines.length && !(lines[i].trim()[0] === fence[1][0] && new RegExp('^' + fence[1][0] + '{' + fence[1].length + ',}\\s*$').test(lines[i].trim()))) code.push(lines[i++]);
        if (i < lines.length) i++;
        var raw = code.join('\n');
        html += options.code ? options.code(language, raw) : '<pre><code' + (language ? ' class="language-' + language + '"' : '') + '>' + escape(raw) + '</code></pre>';
        continue;
      }
      if (line.trim() === '$$' || line.trim() === '\\[') {
        var close = line.trim() === '$$' ? '$$' : '\\]', formula = [];
        i++; while (i < lines.length && lines[i].trim() !== close) formula.push(lines[i++]);
        if (i < lines.length) i++;
        html += '<pre class="aa-md-formula">' + escape(formula.join('\n')) + '</pre>'; continue;
      }
      if (i + 1 < lines.length && cells(line).length > 1 && separator(lines[i + 1])) {
        var headers = cells(line), alignments = cells(lines[i + 1]);
        if (headers.length === alignments.length) {
          var align = alignments.map(function (cell) { return /^:.*:$/.test(cell) ? 'center' : /:$/.test(cell) ? 'right' : 'left'; });
          var rows = []; i += 2;
          while (i < lines.length && lines[i].trim() && cells(lines[i]).length > 1) rows.push(cells(lines[i++]));
          var tableKey = headers.join('¦'), mode = tableViews[tableKey] || 'auto';
          html += '<section class="aa-md-table-block'+(headers.length>=4?' aa-md-table-wide':'')+'" data-table-key="'+escape(tableKey)+'" data-table-mode="'+mode+'">'
            +'<div class="aa-md-table-tools"><span>'+rows.length+' 项 · '+headers.length+' 列</span><div role="group" aria-label="表格阅读方式"><button type="button" data-table-view="table">表格</button><button type="button" data-table-view="cards">逐项</button></div></div>'
            +'<div class="aa-md-table-wrap" role="region" aria-label="表格，可横向滚动" tabindex="0"><table class="aa-md-table" style="min-width:'+Math.max(320,headers.length*160)+'px"><thead><tr>';
          headers.forEach(function (cell, n) { html += '<th scope="col" style="text-align:' + align[n] + '">' + inline(cell, 0, options) + '</th>'; });
          html += '</tr></thead><tbody>';
          rows.forEach(function(row){html += '<tr>';headers.forEach(function(_,n){html += '<td style="text-align:'+align[n]+'">'+inline(row[n]||'',0,options)+'</td>';});html += '</tr>';});
          html += '</tbody></table></div><div class="aa-md-table-cards" role="list" aria-label="逐项阅读">';
          rows.forEach(function(row,index){html += '<article class="aa-md-row-card" role="listitem"><div class="aa-md-card-index">第 '+(index+1)+' 项</div><dl>';headers.forEach(function(header,n){html += '<div><dt>'+inline(header,0,options)+'</dt><dd>'+inline(row[n]||'—',0,options)+'</dd></div>';});html += '</dl></article>';});
          html += '</div></section>'; continue;
        }
      }
      var heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) { var level = heading[1].length; html += '<h' + level + '>' + inline(heading[2], 0, options) + '</h' + level + '>'; i++; continue; }
      if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) { html += '<hr>'; i++; continue; }
      if (/^\s{0,3}>/.test(line)) {
        var quoted = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}> ?/, ''));
        html += '<blockquote>' + render(quoted.join('\n'), options, depth + 1) + '</blockquote>'; continue;
      }
      var item = listItem(line);
      if (item) {
        var indent = item[1].length, ordered = /^\d/.test(item[2]), tag = ordered ? 'ol' : 'ul';
        html += '<' + tag + (ordered && parseInt(item[2], 10) !== 1 ? ' start="' + parseInt(item[2], 10) + '"' : '') + '>';
        while (i < lines.length) {
          item = listItem(lines[i]);
          if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
          var content = [item[3]], contentIndent = item[0].length - item[3].length;
          i++;
          while (i < lines.length) {
            if (!lines[i].trim()) {
              var next = i + 1; while (next < lines.length && !lines[next].trim()) next++;
              if (next < lines.length && /^\s+/.test(lines[next]) && lines[next].search(/\S/) > indent) { content.push(''); i++; continue; }
              break;
            }
            if (lines[i].search(/\S/) <= indent) break;
            content.push(lines[i].slice(Math.min(contentIndent, lines[i].search(/\S/)))); i++;
          }
          html += '<li>' + render(content.join('\n'), options, depth + 1) + '</li>';
          while (i < lines.length && !lines[i].trim()) i++;
        }
        html += '</' + tag + '>'; continue;
      }
      var paragraph = [line]; i++;
      while (i < lines.length && !boundary(i)) paragraph.push(lines[i++]);
      html += '<p>' + inline(paragraph.join('\n'), 0, options).replace(/ {2}\n/g, '<br>') + '</p>';
    }
    return html;
  }
  var tableViews = Object.create(null);
  function mountTables(host) {
    if(!host||host.dataset.arenaTablesMounted)return;
    host.dataset.arenaTablesMounted='true';
    host.addEventListener('click',function(event){
      var button=event.target.closest&&event.target.closest('[data-table-view]');if(!button)return;
      var block=button.closest('.aa-md-table-block');if(!block)return;
      var mode=button.getAttribute('data-table-view');if(mode!=='cards'&&mode!=='table')return;
      tableViews[block.getAttribute('data-table-key')]=mode;
      block.setAttribute('data-table-mode',mode);
      block.querySelectorAll('[data-table-view]').forEach(function(b){b.setAttribute('aria-pressed',String(b===button));});
    });
  }
  var api = { render: render, inline: inline, escape: escape, mountTables: mountTables };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaMarkdown = api;
})(typeof window === 'undefined' ? this : window);
