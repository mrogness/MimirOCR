import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { vi } from 'vitest'

export function stubObjectUrls() {
  const NativeURL = URL
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:test')
    static revokeObjectURL = vi.fn()
  })
}

// Run lifecycle-aware composables inside a real component, including teardown.
export function mountComposable(setup) {
  let result
  const wrapper = mount(defineComponent({
    setup() {
      result = setup()
      return () => null
    },
  }))
  return { result, wrapper }
}

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}
