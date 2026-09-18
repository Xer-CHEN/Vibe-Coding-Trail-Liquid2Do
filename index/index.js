// pages/index/index.js
const db = wx.cloud.database()
const todos = db.collection('todos')
const config = require('../../config.js')

const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const pad = (n) => (n < 10 ? '0' + n : '' + n)

function fmtDue(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())} 周${WEEK[d.getDay()]}`
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function nowTime() {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    list: [],
    pendingCount: 0,
    showModal: false,
    editId: '',
    reminder: false,
    sortAsc: true,
    loading: false,
    form: { title: '', content: '', date: '', time: '09:00' },
    kbOffset: 0,
    showContent: false,
    contentFocus: false
  },

  onLoad() {
    this.refresh()
    // 计算底部安全区（iPhone 底部 Home 指示条区域），键盘高度不含它，需叠加补偿
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    let safeBottom = 0
    if (info.safeArea && info.screenHeight) safeBottom = info.screenHeight - info.safeArea.bottom
    if (safeBottom < 0) safeBottom = 0
    this.safeBottom = safeBottom
    // 键盘高度（px）+ 安全区补偿，直接驱动弹层上移，不再做 px→rpx 换算
    this.kbHandler = (res) => {
      this.setData({ kbOffset: (res.height || 0) + this.safeBottom })
    }
    wx.onKeyboardHeightChange(this.kbHandler)
  },

  onUnload() {
    if (this.kbHandler) wx.offKeyboardHeightChange(this.kbHandler)
  },

  onShow() {
    this.refresh()
  },

  noop() {},

  // 拉取并排序：未完成在上（按截止日期），已完成置底（按截止日期）
  async refresh() {
    this.setData({ loading: true })
    try {
      const res = await todos.limit(100).get()
      const list = this.arrange(res.data)
      this.setData({ list, loading: false })
      // 打开 / 刷新列表时主动检查并下发到期待办（不依赖云函数定时器）
      this.checkReminders()
    } catch (e) {
      console.error(e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请检查云环境', icon: 'none' })
    }
  },

  arrange(arr) {
    const sortFn = (a, b) => (this.data.sortAsc ? a.due - b.due : b.due - a.due)
    const pending = arr.filter((i) => !i.done).sort(sortFn)
    const done = arr.filter((i) => i.done).sort(sortFn)
    const now = Date.now()
    const decorate = (it) => ({
      ...it,
      dueText: fmtDue(it.due),
      overdue: !it.done && it.due < now
    })
    const list = [...pending, ...done].map(decorate)
    this.setData({ pendingCount: pending.length })
    return list
  },

  toggleSort() {
    this.setData({ sortAsc: !this.data.sortAsc }, () => this.refresh())
  },

  // 勾选 / 取消完成
  async toggleDone(e) {
    const { id, done } = e.currentTarget.dataset
    wx.showLoading({ title: '' })
    try {
      await todos.doc(id).update({
        data: {
          done: !done,
          doneTime: !done ? Date.now() : null
        }
      })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 删除
  deleteItem(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '删除待办',
      content: '确认删除该待办事项吗？',
      confirmColor: '#e8635b',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await todos.doc(id).remove()
          this.refresh()
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  },

  // 一键清理所有已完成的待办
  clearDone() {
    const doneItems = this.data.list.filter((i) => i.done)
    if (!doneItems.length) {
      wx.showToast({ title: '没有已完成的待办', icon: 'none' })
      return
    }
    wx.showModal({
      title: '清空已完成',
      content: `确认删除全部 ${doneItems.length} 条已完成的待办事项吗？`,
      confirmColor: '#e8635b',
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '清理中' })
        try {
          await Promise.all(doneItems.map((i) => todos.doc(i._id).remove()))
          wx.showToast({ title: '已清理', icon: 'success' })
          this.refresh()
        } catch (err) {
          console.error(err)
          wx.showToast({ title: '清理失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  // 打开新建
  openAdd() {
    this.setData({
      showModal: true,
      editId: '',
      reminder: false,
      showContent: false,
      contentFocus: false,
      kbOffset: 0,
      form: { title: '', content: '', date: todayStr(), time: nowTime() }
    })
  },

  // 打开编辑
  openEdit(e) {
    const item = e.currentTarget.dataset.item
    this.setData({
      showModal: true,
      editId: item._id,
      reminder: !!item.reminder,
      showContent: !!(item.content && item.content.trim()),
      contentFocus: false,
      kbOffset: 0,
      form: {
        title: item.title,
        content: item.content || '',
        date: item.dueDate,
        time: item.dueTime
      }
    })
  },

  closeModal() {
    this.setData({ showModal: false, kbOffset: 0, contentFocus: false, showContent: false })
  },

  onTitle(e) {
    this.setData({ 'form.title': e.detail.value })
  },
  onContent(e) {
    this.setData({ 'form.content': e.detail.value })
  },
  // 点击「添加补充说明」才展开内容输入并自动聚焦
  toggleContent() {
    this.setData({ showContent: true, contentFocus: true })
  },
  onContentBlur() {
    this.setData({ contentFocus: false })
  },
  onDate(e) {
    this.setData({ 'form.date': e.detail.value })
  },
  onTime(e) {
    this.setData({ 'form.time': e.detail.value })
  },
  onReminder(e) {
    this.setData({ reminder: e.detail.value })
  },

  // 主动触发提醒检查：打开 / 刷新列表时调用，由云函数下发到期待办的微信订阅消息
  // 不依赖云函数定时器，因此即便定时器未注册也能正常提醒
  checkReminders() {
    if (!config.REMINDER_TEMPLATE_ID) return
    wx.cloud.callFunction({
      name: 'sendReminder',
      success: (res) => {
        const r = res.result || {}
        if (r.total && r.sent) {
          console.log('[提醒] 已下发', r.sent, '条', r)
        }
        if (r.errors && r.errors.length) {
          console.error('[提醒] 下发异常', r.errors)
        }
      },
      fail: (e) => console.error('[提醒] 调用云函数失败', e)
    })
  },

  // 请求微信订阅消息授权（对接微信提醒服务）
  requestReminder() {
    const tmplId = config.REMINDER_TEMPLATE_ID
    if (!tmplId) return Promise.resolve(false)
    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [tmplId],
        success: () => resolve(true),
        fail: () => resolve(false)
      })
    })
  },

  // 保存
  async save() {
    const f = this.data.form
    if (!f.title.trim()) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    if (!f.date) {
      wx.showToast({ title: '请选择截止日期', icon: 'none' })
      return
    }

    const due = new Date(`${f.date} ${f.time || '09:00'}`).getTime()
    const data = {
      title: f.title.trim(),
      content: f.content.trim(),
      dueDate: f.date,
      dueTime: f.time || '09:00',
      due,
      reminder: this.data.reminder
    }

    wx.showLoading({ title: '保存中' })
    try {
      if (this.data.reminder) {
        const granted = await this.requestReminder()
        if (!granted && config.REMINDER_TEMPLATE_ID) {
          wx.showToast({ title: '未授权提醒', icon: 'none' })
        }
      }

      if (this.data.editId) {
        await todos.doc(this.data.editId).update({ data })
      } else {
        data.done = false
        data.createTime = Date.now()
        data.reminded = false
        await todos.add({ data })
      }

      this.setData({ showModal: false })
      if (this.data.reminder && !config.REMINDER_TEMPLATE_ID) {
        wx.showToast({ title: '已保存（提醒待配置模板）', icon: 'none' })
      } else {
        wx.showToast({ title: '已保存', icon: 'success' })
      }
      this.refresh()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
