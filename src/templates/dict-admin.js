// Dictionary part: admin panel — login, dashboard, user search, audit trail.

export default {
  en: {
    'admin.meta.dashboard_title': 'Admin — QuoteMint',
    'admin.meta.login_title': 'Admin sign in — QuoteMint',

    'admin.login.heading': 'Admin sign in',
    'admin.login.sub': 'Enter the admin password to continue.',
    'admin.login.label': 'Password',
    'admin.login.submit': 'Sign in',
    'admin.login.busy': 'Signing in…',

    'admin.dash.title': 'Admin',
    'admin.dash.sub': 'Users, Pro grants, and recent activity.',
    'admin.stat.users': 'Total users',
    'admin.stat.quotes': 'Total quotes',
    'admin.stat.users_month': 'Users this month',
    'admin.stat.quotes_month': 'Quotes this month',

    'admin.btn.logout': 'Log out',
    'admin.btn.grant': 'Grant Pro',
    'admin.btn.revoke': 'Revoke',

    'admin.users.title': 'Users',
    'admin.users.heading': 'User search',
    'admin.users.sub': 'Find an account by email or name, then grant or revoke Pro.',
    'admin.users.latest': 'Newest users',
    'admin.users.results': 'Results for “{q}”',
    'admin.users.empty': 'No accounts match.',
    'admin.users.back': 'Dashboard',

    'admin.search.placeholder': 'Email or name',
    'admin.search.submit': 'Search',

    'admin.col.email': 'Email',
    'admin.col.name': 'Name',
    'admin.col.plan': 'Plan',
    'admin.col.renews': 'Renews',
    'admin.col.created': 'Created',
    'admin.col.months': 'Months',
    'admin.col.actions': 'Actions',

    'admin.audit.title': 'Recent admin activity',
    'admin.audit.empty': 'No admin activity yet.',
    'admin.audit.at': 'When',
    'admin.audit.action': 'Action',
    'admin.audit.user': 'Account',
    'admin.audit.detail': 'Detail',
    'admin.action.grant': 'Grant',
    'admin.action.revoke': 'Revoke',

    'admin.confirm_revoke': 'Revoke Pro for {email}? The account returns to the Free plan.',
    'admin.busy.grant': 'Granting…',
    'admin.busy.revoke': 'Revoking…',

    'errcode.bad_password': 'Incorrect password.',
    'errcode.user_not_found': 'No account found for that email.',
    'errcode.invalid_months': 'Months must be a whole number between 1 and 120.',
  },
  zh: {
    'admin.meta.dashboard_title': '管理 — QuoteMint',
    'admin.meta.login_title': '管理员登录 — QuoteMint',

    'admin.login.heading': '管理员登录',
    'admin.login.sub': '请输入管理员密码以继续。',
    'admin.login.label': '密码',
    'admin.login.submit': '登录',
    'admin.login.busy': '登录中…',

    'admin.dash.title': '管理面板',
    'admin.dash.sub': '用户、专业版授权与最近操作。',
    'admin.stat.users': '用户总数',
    'admin.stat.quotes': '报价单总数',
    'admin.stat.users_month': '本月新增用户',
    'admin.stat.quotes_month': '本月新增报价单',

    'admin.btn.logout': '退出登录',
    'admin.btn.grant': '开通专业版',
    'admin.btn.revoke': '取消专业版',

    'admin.users.title': '用户',
    'admin.users.heading': '用户搜索',
    'admin.users.sub': '按邮箱或姓名查找账户，然后开通或取消专业版。',
    'admin.users.latest': '最新用户',
    'admin.users.results': '“{q}”的搜索结果',
    'admin.users.empty': '没有匹配的账户。',
    'admin.users.back': '返回面板',

    'admin.search.placeholder': '邮箱或姓名',
    'admin.search.submit': '搜索',

    'admin.col.email': '邮箱',
    'admin.col.name': '姓名',
    'admin.col.plan': '套餐',
    'admin.col.renews': '到期时间',
    'admin.col.created': '注册时间',
    'admin.col.months': '月数',
    'admin.col.actions': '操作',

    'admin.audit.title': '最近管理操作',
    'admin.audit.empty': '暂无管理操作。',
    'admin.audit.at': '时间',
    'admin.audit.action': '操作',
    'admin.audit.user': '账户',
    'admin.audit.detail': '详情',
    'admin.action.grant': '开通',
    'admin.action.revoke': '取消',

    'admin.confirm_revoke': '确定为 {email} 取消专业版吗？该账户将回到免费版。',
    'admin.busy.grant': '开通中…',
    'admin.busy.revoke': '取消中…',

    'errcode.bad_password': '密码不正确。',
    'errcode.user_not_found': '未找到该邮箱对应的账户。',
    'errcode.invalid_months': '月数必须是 1 到 120 之间的整数。',
  },
};
