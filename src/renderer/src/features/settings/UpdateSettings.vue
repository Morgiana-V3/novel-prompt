<script setup lang="ts">
import HelpTip from '../../shared/ui/HelpTip.vue'
import { useUpdateSettings } from './use-update-settings'
import { settingsState } from './state'
import Icon from '../../shared/ui/Icon.vue'
import UpdateAction from './components/UpdateAction.vue'
const { checking, versionText, updateSub, runCheck } = useUpdateSettings()
</script>

<template>
  <div
    class="card settings-updates"
    style="--d: 160ms"
  >
    <div class="card-head">
      <span class="card-icon"><Icon name="download" /></span>
      <div>
        <h2>
          版本与更新<HelpTip
            label="版本与更新"
            text="安装版启动时及每 6 小时检查更新，发现新版后后台下载。准备好后点击「重启并更新」，已保存的数据会保留。"
          />
        </h2>
      </div>
    </div>
    <div class="form-grid">
      <div class="form-field full">
        <div class="update-line">
          <span
            class="pill"
            :class="settingsState.update?.newer ? 'alias' : 'ok'"
            ><i></i>{{ versionText }}</span
          >
          <span class="muted small grow">{{ updateSub }}</span>
          <button
            class="btn small"
            :disabled="
              checking ||
              ['checking', 'downloading', 'ready', 'installing'].includes(
                settingsState.update?.stage ?? '',
              )
            "
            @click="runCheck"
          >
            <Icon
              name="swap"
              :size="13"
            />{{ checking ? '检查中' : '检查更新' }}
          </button>
          <UpdateAction />
        </div>
        <pre
          v-if="settingsState.update?.newer && settingsState.update.notes"
          class="release-notes"
          >{{ settingsState.update.notes }}</pre>
      </div>
    </div>
  </div>
</template>
