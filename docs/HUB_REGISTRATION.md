# Hub Registration

`journal-metrics-ddl` 是一个专题族仓库：同一个仓库向 Hub 注册三个专题卡，但复用一套 crawler、validator、link-check 和 Pages。

```ts
{
  id: "cas-partition-ddl",
  name: "中科院分区",
  repo: "Just-Agent/journal-metrics-ddl",
  site: "https://just-agent.github.io/journal-metrics-ddl/",
  sourceMode: "cluster",
  clusterId: "journal-metrics-ddl",
  dataUrl: "data/topics/cas-partition-ddl/items.json",
  status: "active"
}

{
  id: "jcr-impact-factor-ddl",
  name: "JCR 与影响因子",
  repo: "Just-Agent/journal-metrics-ddl",
  site: "https://just-agent.github.io/journal-metrics-ddl/",
  sourceMode: "cluster",
  clusterId: "journal-metrics-ddl",
  dataUrl: "data/topics/jcr-impact-factor-ddl/items.json",
  status: "active"
}

{
  id: "journal-volume-ddl",
  name: "期刊发文量",
  repo: "Just-Agent/journal-metrics-ddl",
  site: "https://just-agent.github.io/journal-metrics-ddl/",
  sourceMode: "cluster",
  clusterId: "journal-metrics-ddl",
  dataUrl: "data/topics/journal-volume-ddl/items.json",
  status: "active"
}
```

## 接入注意

- CAS/JCR 明细若来自机构授权数据，只能通过授权 CSV/JSON 导入，不能在公开 crawler 中绕过登录或许可边界。
- `journal-volume-ddl` 的公开发文量首版来自 OpenAlex Source API，页面必须持续显示“开放元数据口径，不等于 WoS/JCR 精确统计”。
- Hub 注册后，子专题更新成功应通过 `repository_dispatch` 通知 `Just-Agent/just-ddl` 立刻同步。
