import { ref, onUnmounted, type Ref } from 'vue'

export function useCameraScanner(videoRef: Ref<HTMLVideoElement | undefined>, onCode: (code: string) => void) {
  const scanning = ref(false)
  const error = ref('')
  let stream: MediaStream | null = null
  let detector: any = null
  let raf: any = null
  let stopped = true

  const supported = () => (
    typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof (window as any).BarcodeDetector !== 'undefined'
  )

  async function stop() {
    stopped = true
    if (raf) { cancelAnimationFrame(raf); raf = null }
    if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null }
    if (videoRef.value) videoRef.value.srcObject = null
    scanning.value = false
  }

  async function start() {
    error.value = ''
    if (!supported()) {
      error.value = '当前浏览器不支持摄像头扫码，请使用扫码枪或手动输入。'
      return false
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      const video = videoRef.value
      if (!video) throw new Error('摄像头组件未就绪')
      video.srcObject = stream
      await video.play()
      detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] })
      scanning.value = true
      stopped = false
      const loop = async () => {
        if (stopped) return
        try {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video)
            if (codes?.length) {
              const value = String(codes[0].rawValue || '').trim()
              if (value) {
                onCode(value)
                await stop()
                return
              }
            }
          }
        } catch (_error) { /* 帧识别失败忽略 */ }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return true
    } catch (err: any) {
      error.value = err?.name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器设置中允许摄像头。' : '摄像头启动失败：' + (err?.message || err)
      await stop()
      return false
    }
  }

  onUnmounted(() => { stop() })
  return { scanning, error, supported, start, stop }
}
