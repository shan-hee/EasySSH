import { ref, type Ref } from 'vue';

export function createRefMap() {
  const mapRef: Ref<Record<string, Element | null>> = ref({});

  const makeSetter = (key: string) => (el: Element | null) => {
    if (!key) return;
    if (el) {
      mapRef.value[key] = el;
    } else if (mapRef.value[key]) {
      // 清理
      mapRef.value[key] = null;
      delete mapRef.value[key];
    }
  };

  return { mapRef, makeSetter };
}

export default { createRefMap };
