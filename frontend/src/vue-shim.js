// 本地 vue shim，绕过 vue 3.5.38 npm 包发布缺陷
// 正常情况直接 import 'vue' 即可，但当前 vue/index.mjs 是坏 stub
// 这里把 reactive/ref 显式 re-export（runtime-core esm bundler 已经包含 computed/watch）

export * from '@vue/runtime-dom';
export {
  reactive,
  ref,
  shallowRef,
  triggerRef,
  customRef,
  toRef,
  toRefs,
  toRaw,
  toValue,
  markRaw,
  unref,
  shallowReactive,
  readonly,
  shallowReadonly,
  isReactive,
  isReadonly,
  isRef,
  isProxy,
  isShallow
} from '@vue/reactivity';

// diagnostic: 强制让 reactive 被认为被使用
import { reactive as _r } from '@vue/reactivity';
console.log('vue-shim loaded, reactive=', typeof _r);
