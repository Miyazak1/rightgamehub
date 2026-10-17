export const mission = {
  format:'mooyu.learning-mission',
  schemaVersion:1,
  id:'physics.energy-train',
  version:'1.0.0',
  title:{ 'zh-CN':'能量列车：穿越三段线路',en:'Flux Express: three-stage route' },
  initialNodeId:'accelerate',
  capabilitySlots:['traction','slope','braking'],
  clocks:[{ id:'window',initial:180,minimum:0,maximum:180 }],
  resources:[{ id:'battery',initial:100,minimum:0,maximum:100 }],
  nodes:[
    {
      id:'accelerate',kind:'calculation',title:{ 'zh-CN':'配置牵引力',en:'Configure traction' },capabilitySlots:['traction'],
      actions:[{
        id:'commit-traction',title:{ 'zh-CN':'提交牵引方案',en:'Commit traction plan' },clockCosts:{ window:18 },resourceCosts:{ battery:15 },
        success:[{ source:'metric',id:'traction.acceleration',operator:'between',values:[2.8,3.2] }],
        onSuccess:{ to:'climb' },onFailure:{ to:'accelerate' },
        evidence:[{ claimId:'newton.configure',kind:'configuration',strength:1 }]
      }]
    },
    {
      id:'climb',kind:'simulation',title:{ 'zh-CN':'通过能量坡道',en:'Cross the energy slope' },capabilitySlots:['slope'],
      actions:[{
        id:'commit-climb',title:{ 'zh-CN':'运行坡道方案',en:'Run slope plan' },clockCosts:{ window:24 },resourceCosts:{ battery:25 },
        success:[{ source:'metric',id:'slope.exit-speed',operator:'between',values:[3.5,4.5] }],
        onSuccess:{ to:'brake' },onFailure:{ to:'climb' },
        evidence:[{ claimId:'energy.balance',kind:'calculation',strength:1 }]
      }]
    },
    {
      id:'brake',kind:'calculation',title:{ 'zh-CN':'计算制动窗口',en:'Calculate braking window' },capabilitySlots:['braking'],
      actions:[{
        id:'commit-braking',title:{ 'zh-CN':'执行制动',en:'Apply braking' },clockCosts:{ window:16 },resourceCosts:{ battery:20 },
        success:[{ source:'metric',id:'braking.margin',operator:'between',values:[0,1.5] }],
        onSuccess:{ to:'debrief' },onFailure:{ to:'brake' },
        evidence:[{ claimId:'braking.calculate',kind:'calculation',strength:1 }]
      }]
    },
    {
      id:'debrief',kind:'debrief',title:{ 'zh-CN':'复盘三段方案',en:'Debrief the route' },capabilitySlots:[],
      actions:[{
        id:'complete-debrief',title:{ 'zh-CN':'完成解释',en:'Complete explanation' },
        success:[],onSuccess:{ to:'debrief' },
        evidence:[{ claimId:'system.explain',kind:'explanation',strength:1 }]
      }]
    }
  ],
  outcomes:[
    { id:'window-lost',kind:'failure',title:{ 'zh-CN':'错过通行窗口',en:'Transit window lost' },when:[{ source:'clock',id:'window',operator:'lte',value:0 }] },
    { id:'battery-empty',kind:'failure',title:{ 'zh-CN':'电量耗尽',en:'Battery depleted' },when:[{ source:'resource',id:'battery',operator:'lte',value:0 }] },
    { id:'route-complete',kind:'success',title:{ 'zh-CN':'线路通过',en:'Route complete' },when:[{ source:'state',id:'completed.debrief',operator:'truthy' }] }
  ]
};

export const bindings = {
  format:'mooyu.mission-capability-binding',schemaVersion:1,missionId:'physics.energy-train',
  bindings:[
    { slot:'traction',moduleId:'physics.newton-cart',capability:'domain.motion',metrics:[{ id:'traction.acceleration',path:'acceleration' }] },
    { slot:'slope',moduleId:'physics.work-energy',capability:'domain.work-energy',metrics:[{ id:'slope.exit-speed',path:'exitSpeed' }] },
    { slot:'braking',moduleId:'physics.braking',capability:'domain.braking',metrics:[{ id:'braking.margin',path:'margin' }] }
  ]
};

export const evidenceModel = {
  format:'mooyu.learning-evidence-model',schemaVersion:1,id:'physics.energy-train.evidence',
  objectiveIds:['newton.second-law','mechanical-energy','uniform-deceleration'],
  claims:[
    { id:'newton.configure',objectiveId:'newton.second-law',kind:'configuration',weight:1,minimumStrength:.8,required:true },
    { id:'energy.balance',objectiveId:'mechanical-energy',kind:'calculation',weight:1,minimumStrength:.8,required:true },
    { id:'braking.calculate',objectiveId:'uniform-deceleration',kind:'calculation',weight:1,minimumStrength:.8,required:true },
    { id:'system.explain',objectiveId:'mechanical-energy',kind:'explanation',weight:.5,minimumStrength:.8,required:true }
  ]
};
