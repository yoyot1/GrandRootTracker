// The 24 games read from the sample screenshots. Used by tests and the preview.
// Row: [name, faction, score-or-badge, winner?]
const rows = [
  ['score', [['yoyot1','vagabond',33,1],['gogogaijin','riverfolk',29],['shrd1123','duchy',24],['Constr','hundreds','dominance:fox']]],
  ['score', [['yoyot1','hundreds',31,1],['DibsOnRugarth','duchy',22],['gogogaijin','eyrie',17],['sabiqm','alliance',9]]],
  ['score', [['yoyot1','hundreds',30,1],['gogogaijin','keepers',26],['shrd1123','alliance',19],['Constr','eyrie',11]]],
  ['score', [['yoyot1','alliance',31,1],['gogogaijin','corvid',29],['DibsOnRugarth','duchy',24],['shrd1123','riverfolk',24]]],
  ['coalition', [['DibsOnRugarth','alliance',33,1],['TheRandomosity','vagabond','coalition:alliance',1],['yoyot1','duchy',28],['shrd1123','eyrie',27]]],
  ['score', [['DibsOnRugarth','marquise',30,1],['gogogaijin','eyrie',20],['shrd1123','corvid',20],['yoyot1','riverfolk',17]]],
  ['score', [['DibsOnRugarth','hundreds',30,1],['gogogaijin','duchy',27],['yoyot1','vagabond',23],['shrd1123','alliance',19]]],
  ['score', [['gogogaijin','riverfolk',30,1],['TheRandomosity','marquise',22],['Constr','hundreds',20],['DibsOnRugarth','corvid',19]]],
  ['score', [['gogogaijin','hundreds',31,1],['DibsOnRugarth','keepers',28],['shrd1123','alliance',25],['yoyot1','duchy',16]]],
  ['score', [['shrd1123','alliance',32,1],['DibsOnRugarth','keepers',27],['Constr','riverfolk',19],['yoyot1','hundreds',17]]],
  ['score', [['gogogaijin','keepers',33,1],['DibsOnRugarth','hundreds',21],['yoyot1','riverfolk',20],['shrd1123','vagabond',15]]],
  ['score', [['DibsOnRugarth','corvid',30,1],['yoyot1','alliance',29],['shrd1123','duchy',25],['TaishiCi','hundreds',22]]],
  ['score', [['DibsOnRugarth','hundreds',30,1],['yoyot1','alliance',24],['shrd1123','corvid',20],['gogogaijin','marquise',19]]],
  ['score', [['gogogaijin','duchy',30,1],['Constr','corvid',18],['yoyot1','hundreds',14],['DibsOnRugarth','eyrie',13]]],
  ['score', [['shrd1123','duchy',30,1],['Constr','marquise',13],['DibsOnRugarth','hundreds',12],['yoyot1','alliance',8]]],
  ['score', [['shrd1123','hundreds',30,1],['yoyot1','riverfolk',23],['DibsOnRugarth','corvid',14],['Constr','keepers',7]]],
  ['score', [['shrd1123','riverfolk',31,1],['yoyot1','corvid',17],['gogogaijin','lizard',14],['DibsOnRugarth','keepers',11]]],
  ['score', [['lucas321','duchy',30,1],['yoyot1','hundreds',24],['DibsOnRugarth','corvid',17],['shrd1123','vagabond','coalition:corvid']]],
  ['score', [['DibsOnRugarth','duchy',30,1],['BuffaloBuffalo','hundreds',25],['sabiqm','marquise',18],['shrd1123','eyrie',14]]],
  ['score', [['DibsOnRugarth','vagabond',31,1],['sabiqm','duchy',17],['lucas321','marquise',15],['shrd1123','alliance',14]]],
  ['score', [['shrd1123','hundreds',30,1],['DibsOnRugarth','duchy',25],['gogogaijin','eyrie',19],['lucas321','alliance',16]]],
  ['score', [['sabiqm','hundreds',31,1],['lucas321','corvid',29],['shrd1123','marquise',26],['DibsOnRugarth','eyrie',24]]],
  ['score', [['BuffaloBuffalo','corvid',30,1],['DibsOnRugarth','marquise',24],['lucas321','duchy',20],['TheRandomosity','eyrie',18]]],
  ['score', [['gogogaijin','hundreds',30,1],['TaishiCi','marquise',27],['yoyot1','keepers',24],['Constr','vagabond',19]]],
];

const maps = ['autumn', 'mountain', 'winter', 'lake', 'lake', 'mountain', 'mountain', 'lake', 'winter', 'autumn', 'lake', 'mountain', 'autumn', 'winter', 'lake', 'autumn', 'winter', 'autumn', 'autumn', 'autumn', 'mountain', 'lake', 'lake', 'mountain'];

export const sampleGames = rows.map(([winType, players], i) => ({
  id: `sample-${String(i + 1).padStart(2, '0')}`,
  date: null,
  map: maps[i],
  win_type: winType,
  banner_text: '',
  needs_review: false,
  review_notes: [],
  source: null,
  players: players.map(([name, faction, s, winner]) => {
    const [badge, detail] = typeof s === 'string' ? s.split(':') : ['score', null];
    return { name, faction, score: typeof s === 'number' ? s : null, winner: Boolean(winner), badge, badge_detail: detail };
  }),
}));
