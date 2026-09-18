// app.js
const config = require('./config.js')

App({
  globalData: {
    // 云开发环境 ID（在微信开发者工具「云开发」控制台获取，留空则使用默认环境）
    cloudEnv: config.CLOUD_ENV
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请使用 2.2.3 或以上的基础库')
      return
    }
    wx.cloud.init({
      // 留空时自动使用默认环境
      env: config.CLOUD_ENV || undefined,
      traceUser: true
    })

    // 说明：本小程序未调用任何「隐私接口」（云数据库、订阅消息都不在隐私接口清单内），
    // 因此不需要在启动时弹隐私授权。若后续接入位置/相册/摄像头等隐私接口，
    // 再来这里用 wx.getPrivacySetting + wx.requirePrivacyAuthorize 做授权引导。
  }
})
