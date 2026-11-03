<script setup lang="ts">
import Icon from '../../shared/ui/Icon.vue'
</script>

<template>
  <article class="card operation-guide">
    <div class="card-head">
      <span class="card-icon"><Icon name="book" /></span>
      <h2>操作说明</h2>
    </div>
    <section>
      <h3>Tag 自动补全</h3>
      <p>
        在主提示词、负面提示词和角色提示词中直接输入，即可查看候选。逗号、换行或
        <code>|</code> 分隔当前 Tag；支持英文名称、别名、拼音首字母和中文。
      </p>
      <p>
        英文至少输入两个字符，中文可输入一个字。<code>artist:</code> 后只提示画师，<code
          >Text:</code
        >
        后的画面文字不自动补全。
      </p>
    </section>
    <section>
      <h3>/ 快捷搜索</h3>
      <p>
        输入 <code>/</code> 开启搜索，例如
        <code>/long hair</code>、<code>/长发</code>。空格属于查询，也可在句子中间搜索。选中后去掉
        <code>/</code>，保留两侧原文。
      </p>
      <p>
        <code>/artist:wl</code> 只搜索画师；也可搜索 <code>artist:</code>、<code>Text:</code>、<code
          >source#</code
        >
        等常用语法。
      </p>
    </section>
    <section>
      <h3>选择与退出</h3>
      <dl>
        <div>
          <dt><kbd>↑</kbd> <kbd>↓</kbd></dt>
          <dd>切换候选，超出可见范围时列表自动滚动。</dd>
        </div>
        <div>
          <dt><kbd>Tab</kbd> / <kbd>Enter</kbd></dt>
          <dd>插入选中的候选，也可以直接点击。</dd>
        </div>
        <div>
          <dt><kbd>Esc</kbd></dt>
          <dd>关闭提示，保留已经输入的文字。</dd>
        </div>
        <div>
          <dt><kbd>Ctrl</kbd> + <kbd>Z</kbd></dt>
          <dd>一次撤销本次插入。</dd>
        </div>
      </dl>
      <p>
        两种方式都不自动追加逗号或空格。删除搜索用的
        <code>/</code>、移出搜索范围或离开输入框也会退出搜索。中文输入法确认文字时不会选中 Tag。
      </p>
    </section>
    <section>
      <h3>候选数量</h3>
      <p>
        在「设置 → Tag 词库 → Tag 候选数量」调整，默认 20 个，范围 1–100
        个。点击「保存词库设置」后，自动补全和 / 搜索共用该数量；结果较多时可滚动查看。
      </p>
    </section>
  </article>
</template>

<style scoped>
.operation-guide section + section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

.operation-guide p,
.operation-guide dd {
  color: var(--text2);
  line-height: 1.8;
}

.operation-guide p {
  margin: 10px 0 0;
}

.operation-guide dl {
  margin: 12px 0;
}

.operation-guide dl > div {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  gap: 12px;
  margin: 8px 0;
}

.operation-guide dd {
  margin: 0;
}

.operation-guide kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 12px;
}
</style>
