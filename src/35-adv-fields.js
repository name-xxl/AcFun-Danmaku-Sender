    // ============================================================
    //  高级字段统一声明（单一真源）
    // ============================================================
    // 理解卡｜我拥有：ADV_FIELDS（14 条可调字段，每条带一个 UI 槽 ui）、ADV_GATES（3 个「启用」开关）、
    //   以及 key ↔ advancedConfig 路径的换算 advFieldPath。
    // 我承诺：**一张表驱动三处**——(a) 高级编辑区的 17 个控件（85-danmaku 的 renderAdvancedForm 交给
    //   gdm-form.buildFieldForm 生成）、(b) openAdjustablePicker 的勾选清单、(c) exportAdvancedPreset 的
    //   「勾选 → preset.params」转换。字段顺序 = 编辑区行序 = 勾选层分组序 = 导出 params 序。
    // 我永不：不碰 DOM；不 import 上层（40-core 的 ADJUSTABLE_FIELDS 由本表派生，反向 import 会成环）；
    //   不在这里写事件回调（值怎么读、改动后做什么，全部由消费方的 ctx 决定）。
    // 改我前读：ui.id 是 readAdvancedConfig 的**回读契约**（它按 id 取值，那段代码一行未改），
    //   ui.read + default 是三处值回退链的声明——test/unit/adv-fields.test.mjs 把「回读侧读到的 id
    //   与它所用的兜底 token」与这张表双向钉住，改任一侧即红。
    // 6.12.0：本表与 40-core 原先手写的 ADJUSTABLE_FIELDS（14 条）合并——那两份声明描述同一批字段
    //   （80-ui 的手写表单 + 勾选层），是同一批字段写两处的老病；现由本表派生，勾选层与导出不再有第二份。

import { DEFAULT_SHADOW_PLACEHOLDER, DEFAULT_SHINE_PLACEHOLDER, DEFAULT_ZINDEX } from './10-constants.js';

    // 字段条目的槽位：
    //   key/label/group/type/min/max/step/default —— 勾选层与导出 params 用的字段形态（原 ADJUSTABLE_FIELDS 逐字保留）；
    //     label 只给勾选层看（编辑区的字段名由行标题 + 单元前缀表达，不复用 label）
    //   ui —— 只给编辑区看的槽位：
    //     id       控件 id。与 buildParamControl 相反，本区控件**必须**有 id：id 就是回读契约
    //     prefix   行内单元的前缀文字（纯文本节点，X/Y/Z 与「模糊」「大小」）
    //     cellClass 行内单元的包裹元素类名（三连用 cf-adv-3；不传则控件裸放行内，前缀直接进行）
    //     read     值回退链，三处不同就在这里声明，别统一：
    //              'value' 直接值——显示 raw ?? default（层级/旋转/缩放/模糊）
    //              'gate'  门控值——门开显示 raw ?? default，**门关显示 default**（投影/外发光的占位回退）
    //     gate     门控 key（= 同 group 的 ADV_GATES 条目的 key）；门关时该控件 disabled
    //     after    控件紧后的说明 span（沿用 list 控件的 { text, style } 形状，如「px」小字）
    const ADV_FIELDS = [
        // —— 直接值：层级 / 旋转 / 缩放 / 模糊 ——
        { key: 'effects.zIndex', label: '层级', group: '层级', type: 'number', min: 1, max: 99, step: 1, default: DEFAULT_ZINDEX,
            ui: { id: 'cf-adv-zindex', read: 'value' } },
        { key: 'effects.rotate.x', label: '旋转 X°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0,
            ui: { id: 'cf-adv-rx', prefix: 'X', cellClass: 'cf-adv-3', read: 'value' } },
        { key: 'effects.rotate.y', label: '旋转 Y°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0,
            ui: { id: 'cf-adv-ry', prefix: 'Y', cellClass: 'cf-adv-3', read: 'value' } },
        { key: 'effects.rotate.z', label: '旋转 Z°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0,
            ui: { id: 'cf-adv-rz', prefix: 'Z', cellClass: 'cf-adv-3', read: 'value' } },
        { key: 'effects.scale.x', label: '缩放 X', group: '缩放', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1,
            ui: { id: 'cf-adv-sx', prefix: 'X', cellClass: 'cf-adv-3', read: 'value' } },
        { key: 'effects.scale.y', label: '缩放 Y', group: '缩放', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1,
            ui: { id: 'cf-adv-sy', prefix: 'Y', cellClass: 'cf-adv-3', read: 'value' } },
        // 模糊：门控只管「开/关」，数值本身照常显示存储值——旧模板是 `blur || 0`，与 raw ?? default(0) 等价
        // （模糊关时 readAdvancedConfig 把 blur 归 0，故 off 与 default 不会分叉）
        { key: 'effects.blur', label: '模糊(px)', group: '模糊', type: 'number', min: 0, max: 50, step: 0.5, default: 0,
            ui: { id: 'cf-adv-blur', read: 'value', gate: 'blur', after: { text: 'px', style: 'font-size:11px;color:#999' } } },
        // —— 门控值：投影 ——（门关时三个数值 + 颜色都显示 DEFAULT_SHADOW_PLACEHOLDER.*，与旧模板一致）
        { key: 'effects.shadow.x', label: '投影 X', group: '投影', type: 'number', min: -100, max: 100, step: 1, default: DEFAULT_SHADOW_PLACEHOLDER.x,
            ui: { id: 'cf-adv-shx', prefix: 'X', cellClass: 'cf-adv-3', read: 'gate', gate: 'shadow' } },
        { key: 'effects.shadow.y', label: '投影 Y', group: '投影', type: 'number', min: -100, max: 100, step: 1, default: DEFAULT_SHADOW_PLACEHOLDER.y,
            ui: { id: 'cf-adv-shy', prefix: 'Y', cellClass: 'cf-adv-3', read: 'gate', gate: 'shadow' } },
        { key: 'effects.shadow.blur', label: '投影模糊', group: '投影', type: 'number', min: 0, max: 50, step: 0.5, default: DEFAULT_SHADOW_PLACEHOLDER.blur,
            ui: { id: 'cf-adv-shb', prefix: '模糊', cellClass: 'cf-adv-3', read: 'gate', gate: 'shadow' } },
        { key: 'effects.shadow.color', label: '投影色', group: '投影', type: 'color', default: DEFAULT_SHADOW_PLACEHOLDER.color,
            ui: { id: 'cf-adv-shc', read: 'gate', gate: 'shadow' } },
        // —— 门控值：外发光 ——（门关时两个数值 + 颜色都显示 DEFAULT_SHINE_PLACEHOLDER.*）
        { key: 'effects.shine.blur', label: '发光模糊', group: '外发光', type: 'number', min: 0, max: 50, step: 0.5, default: DEFAULT_SHINE_PLACEHOLDER.blur,
            ui: { id: 'cf-adv-snb', prefix: '模糊', cellClass: 'cf-adv-3', read: 'gate', gate: 'shine' } },
        { key: 'effects.shine.size', label: '发光大小', group: '外发光', type: 'number', min: 0, max: 20, step: 0.5, default: DEFAULT_SHINE_PLACEHOLDER.size,
            ui: { id: 'cf-adv-sns', prefix: '大小', cellClass: 'cf-adv-3', read: 'gate', gate: 'shine' } },
        { key: 'effects.shine.color', label: '发光色', group: '外发光', type: 'color', default: DEFAULT_SHINE_PLACEHOLDER.color,
            ui: { id: 'cf-adv-snc', read: 'gate', gate: 'shine' } },
    ];

    // 启用开关（旧模板里三个 `<label class="cf-chk"><input type="checkbox" id="cf-adv-*-on">启用</label>`）：
    //   key     —— 门控 key，同时是 advancedConfig 的顶层路径（'blur' / 'shadow' / 'shine'）；
    //              字段靠 ui.gate 认领自己的门，门靠它读自己的存储值
    //   checked —— 勾选判据：'positive'（raw > 0，模糊）/ 'truthy'（!!raw，投影与外发光）
    //   group   —— 排进哪一行（行首、同行字段之前）；label/className 是开关自身的文案与包裹类名
    const ADV_GATES = [
        { key: 'blur', id: 'cf-adv-blur-on', type: 'checkbox', label: '启用', group: '模糊', className: 'cf-chk', checked: 'positive' },
        { key: 'shadow', id: 'cf-adv-sh-on', type: 'checkbox', label: '启用', group: '投影', className: 'cf-chk', checked: 'truthy' },
        { key: 'shine', id: 'cf-adv-sn-on', type: 'checkbox', label: '启用', group: '外发光', className: 'cf-chk', checked: 'truthy' },
    ];

    // key → advancedConfig 路径：effects 与 advancedConfig 同形，去掉 'effects.' 前缀即得；
    // 门 key 本就是顶层路径（'shadow'），同一函数两处通用。别在消费方再写一次这个换算。
    function advFieldPath(key) { return String(key).replace(/^effects\./, ''); }

// —— ESM 导出 ——（40-core 转发派生的 ADJUSTABLE_FIELDS，本文件不导出它：冒烟测试按导出名收账，
//   同名跨模块导出会撞名）
export { ADV_FIELDS, ADV_GATES, advFieldPath };
