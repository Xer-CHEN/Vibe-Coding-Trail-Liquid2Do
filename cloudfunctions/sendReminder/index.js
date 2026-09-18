// cloudfunctions/sendReminder/index.js
// 定时检查即将到期的待办，并通过「订阅消息」下发微信提醒
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// ⚠️ 在 MP 后台「订阅消息」中添加「事项提醒」类模板后，把模板 ID 填到 config.js
// 本模板关键词：事项主题 -> thing1，截止时间 -> time10
// 注意：thing1 / time10 是微信分配给该模板的关键词 key，请以 MP 后台「我的模板」里
//       实际显示的关键词 key 为准；若不一致，请同步修改下方 data 字段的 key
const TEMPLATE_ID = '_d7dzUSkokopBazDUIwqthMKI-Bxzh8XApVF1WBQPx8'

exports.main = async () => {
  if (!TEMPLATE_ID) {
    return { skipped: true, reason: '未配置 TEMPLATE_ID' }
  }

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const now = Date.now()
  // 仅在到达 / 超过截止时间后才提醒，绝不提前；
  // 截止后 30 分钟内打开 App 仍会补发一次，避免刚好晚一点打开就漏提醒
  const GRACE_AFTER = 30 * 60 * 1000

  const where = {
    done: _.neq(true),
    reminder: true,
    reminded: _.neq(true),
    due: _.gte(now - GRACE_AFTER).and(_.lte(now))
  }
  // 由客户端触发时，只处理当前用户自己的待办（定时器触发时 OPENID 为空，则处理全部）
  if (openid) where._openid = openid

  const res = await db
    .collection('todos')
    .where(where)
    .limit(100)
    .get()

  let sent = 0
  const errors = []
  for (const t of res.data) {
    if (!t._openid) {
      errors.push({ id: t._id, err: 'missing _openid' })
      continue
    }
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: t._openid,
        templateId: TEMPLATE_ID,
        page: 'pages/index/index',
        data: {
          thing1: { value: t.title },                     // 事项主题
          time10: { value: `${t.dueDate} ${t.dueTime}` }  // 截止时间
        }
      })
      await db.collection('todos').doc(t._id).update({ data: { reminded: true } })
      sent++
    } catch (e) {
      const msg = e && e.errMsg ? e.errMsg : ('' + e)
      console.error('发送失败', t._openid, msg)
      errors.push({ id: t._id, err: msg })
    }
  }

  return { total: res.data.length, sent, errors }
}
