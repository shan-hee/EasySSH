import { ref } from 'vue';

export function createRefMap() {
  const mapRef = ref({});

  const makeSetter = key => el => {
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
