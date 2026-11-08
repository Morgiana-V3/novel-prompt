import { shallowRef } from 'vue'
import { shellState } from '../../shared/state/shell'
import type { ArtistBlueprint } from './blueprints'

/**
 * 其他功能把内容交给画师调试的收件箱（如图片反推试图结果的「带到画师调试」）。
 * 画师调试的状态只在它自己的视图里维护，这里只放一份待领取的底稿，由 ArtistStudio 领取后清空，
 * 不建立第二套画师调试状态。
 */
export const artistInbox = shallowRef<ArtistBlueprint | null>(null)

export function sendToArtistStudio(blueprint: ArtistBlueprint) {
  artistInbox.value = blueprint
  shellState.tab = 'artists'
}
