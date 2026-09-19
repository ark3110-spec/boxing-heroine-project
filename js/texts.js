export const COMMAND_TEXTS = {
  cheer: {
    name: "応援する",
    description: "やる気を上げる基本行動。優君は少し疲れる。",
    preview: {
      playerPop: "応援の構え",
      rivalPop: "わくわく待機",
    },
    responses: [
      { speaker: "優", text: "瑞花の格好いいところ見せてくれるんでしょ。楽しみにしてるからね" },
      { speaker: "瑞花", text: "うん！わかった！！" },
    ],
  },
  love: {
    name: "ハグを受け入れる",
    description: "愛情を大きく上げる。優君は少し精神力を使う。",
    preview: {
      playerPop: "受け止める",
      rivalPop: "ぎゅーっ",
    },
    responses: [
      { speaker: "優", text: "ほら、いいよ。おいで" },
      { speaker: "瑞花", text: "ゆうくんだいすき～～～！！❤" },
    ],
  },
  rest: {
    name: "休む（塩対応）",
    description: "優君を立て直す回復行動。ただし愛情とやる気が下がる。",
    preview: {
      playerPop: "しばらく休憩",
      rivalPop: "そわそわ心配",
    },
    responses: [
      { speaker: "優", text: "ごめん、ちょっと休むね…" },
      { speaker: "瑞花", text: "大丈夫！？お薬とかお湯とかもってくる？" },
    ],
  },
  gift: {
    name: "プレゼントを渡す",
    description: "1ゲーム中1回のみ。気力2以上で使える切り札。",
    preview: {
      playerPop: "プレゼント準備",
      rivalPop: "きらきら期待",
    },
    responses: [
      { speaker: "優", text: "はい、ど～ぞ♪" },
      { speaker: "瑞花", text: "ありがとうっ！！がんばるっっ！！" },
    ],
    errors: {
      used: "プレゼントはこのステージで既に使っています。",
      spirit: "プレゼントを渡すには気力が2以上必要です。",
    },
  },
};

export const STAGE_TEXTS = {
  stage1: {
    name: "ステージ1: 嵐の前のなんとやら",
    opening: {
      matchTitle: {
        label: "MAIN EVENT",
        title: "日本チャンピオン決定戦",
        subtitle: "JAPAN TITLE MATCH",
      },
      championScene: {
        title: "JAPAN CHAMPION",
        subtitle: "MINADUKI ZUIKA",
        image: "assets/gallery/OP_1.png",
        alt: "日本チャンピオンになった瑞花",
        placeholderTitle: "チャンピオンイラスト",
        placeholderBody: "画像を表示できませんでした。",
      },
      narration: {
        label: "PROLOGUE",
        text: "プロ入り後無敗のまま危なげなく日本チャンピオンになった水無月瑞花（みなづきずいか）であったが、その防衛戦の対戦相手が決まってから……",
      },
      introScene: {
        title: "DEFENSE MATCH",
        background: "assets/backgrounds/OP/oheya.png",
        alt: "防衛戦前の導入背景",
        placeholderTitle: "導入イラスト",
        placeholderBody: "画像を表示できませんでした。",
        characters: {
          left: {
            name: "優君",
            image: "assets/characters/yuu/yuu_idle.png",
            alt: "優君",
          },
          right: {
            name: "瑞花",
            image: "assets/characters/zuika/zuika_dogeza.png",
            alt: "瑞花",
          },
        },
        dialogueLabel: "TALK",
        dialogues: [
          {
            speaker: "瑞花",
            text: "優君！！！お願いがあります！！！",
            speakerVisual: "right",
            effect: "shake",
            duration: 1800,
          },
          {
            speaker: "優君",
            text: "きゅ、急に何？ 藪から棒に……",
            speakerVisual: "left",
            effect: "sweat",
            duration: 1800,
          },
          {
            speaker: "瑞花",
            text: "優君成分が足りないの～～～。応援して～～～～ぎゅってして、よしよしってして～～～！！ でないと試合勝てない～～～",
            speakerVisual: "right",
            effect: "wobble",
            duration: 2700,
          },
          {
            speaker: "優君",
            text: "・・・はぁ、しょうがないなぁ",
            speakerVisual: "left",
            effect: "sigh",
            duration: 1800,
          },
          {
            speaker: "瑞花",
            text: "やった～～～～！！❤ありがとう！優君！！❤",
            speakerVisual: "right",
            rightImage: "assets/characters/zuika/zuika_idle.png",
            effect: "hearts",
            duration: 2200,
          },
        ],
      },
    },
    introLines: [
      {
        speaker: "ナレーション",
        text: "水無月瑞花（みなづき　ずいか）。天才女子高生ボクサーの日本チャンピオン。その彼女が今危機に瀕していた",
      },
      {
        speaker: "瑞花",
        text: "優君！！！お願いがあります！！！",
      },
      {
        speaker: "優君",
        text: "きゅ、急に何？藪から棒に・・・・",
      },
      {
        speaker: "瑞花",
        text: "優君成分が足りないの～～～。応援して～～～～ぎゅってして、よしよしってして～～～！！でないと試合勝てない～～～",
      },
      {
        speaker: "ナレーション",
        text: "これは天才女子高生ボクサー水無月瑞花のわがままに応えることになってしまった優の頑張り物語である",
      },
    ],
    endings: {
      care: {
        title: "強制看病エンド",
        description: "優君の体力が尽き、瑞花は試合を後回しにして看病へ。勝負より大切なものが前に出た結末。",
      },
      boycott: {
        title: "無気力ボイコットエンド",
        description: "愛情も闘志も失った瑞花は、そのまま帰宅。控室は重たい沈黙だけを残した。",
      },
      obsession: {
        title: "優君好き好きエンド",
        description: "瑞花の気持ちは最高潮。でも試合への集中はゼロ。抱きついたまま離れない甘すぎる結末。",
      },
      foul: {
        title: "反則負けエンド",
        description: "優君成分欠乏のまま試合へ突入。怒りが暴発し、瑞花は反則負けになってしまう。",
      },
      victory: {
        title: "試合勝利エンド",
        description: "愛情も闘志もたっぷり蓄えて気力十分、瑞花は見事に勝利。優君の支えが、最後まで力になった。",
        victoryFlavor: [
          "ROUND FINAL",
          "MIZUKA RUSH!",
          "K.O.!!",
          "CHAMPION SUPPORT COMPLETE",
        ],
      },
    },
    gallery: {
      "opening-champion": {
        title: "OP試合後の一枚",
        description: "OPの試合シーン直後に入るチャンピオンイラスト。",
        comments: [
          { speaker: "優", text: "いやあ、さすが天才女子ボクサーさん" },
          { speaker: "瑞花", text: "優君のためならたとえ誰にも負けません！！" },
        ],
      },
      "ending-win": {
        title: "試合勝利の一枚",
        description: "バランスよく支えきった先で見られる勝利CG。",
        comments: [
          { speaker: "優", text: "ほんとはなにもなくてもこれくらいしてくれるよね？" },
          { speaker: "瑞花", text: "でもでも！やっぱり愛はほしいのです！！" },
        ],
      },
      "ending-care": {
        title: "強制看病の一枚",
        description: "優君が限界になり、瑞花が看病に回るCG。",
        comments: [
          { speaker: "優", text: "ここまでしなくても大丈夫だよ？" },
          { speaker: "瑞花", text: "ほんとに倒れたら全部投げ出すからね" },
        ],
      },
      "ending-boycott": {
        title: "無気力ボイコットの一枚",
        description: "愛情もやる気も尽きて帰ってしまうCG。",
        comments: [
          { speaker: "優", text: "まだ、相手に八つ当たりしないだけ、まし…？" },
          { speaker: "瑞花", text: "頑張って別のお仕事で、別の格好いい私になるから！！" },
        ],
      },
      "ending-obsession": {
        title: "優君好き好きの一枚",
        description: "試合どころではなくなる甘すぎるCG。",
        comments: [
          { speaker: "優", text: "試合前にこうなるのはやめてね" },
          { speaker: "瑞花", text: "じゃあ試合なければ・・・！！あいたっ" },
        ],
      },
      "ending-foul": {
        title: "反則負けの一枚",
        description: "不満が爆発して反則負けになるCG。",
        comments: [
          { speaker: "優", text: "だめだよ？" },
          { speaker: "瑞花", text: "は～い（けどこうやって壊すのもドキドキしちゃうかも❤）" },
        ],
      },
    },
    ui: {
      initialLog: "優君の体力気力に配りながら。瑞花を応援して、5ターン後の試合に備えよう。",
      commandRejected: {
        finished: "ゲームは終了しています。",
        forcedRest: "次のターンは強制休憩。休むのみ選択できます。",
      },
      gameScreen: {
        labels: {
          playerArea: "",
          rivalArea: "",
          playerPop: "優君",
          rivalPop: "瑞花",
          talkBox: "会話欄",
          commandSelect: "行動を選ぶ",
          commandConfirm: "この行動で進める？",
        },
        actions: {
          back: "戻る",
          confirm: "決定",
        },
        defaultConversation: [
          { speaker: "瑞花", text: "優君、次はどうしてくれるの？" },
          { speaker: "優", text: "ん～どうしようかな。" },
        ],
        defaultPops: {
          player: "優",
          rival: "瑞花",
        },
        previewHint: "コマンドを選ぶとポップと会話が先に変わります。問題なければ決定してください。",
      },
      turnMessages: {
        immediateEnding: "{ending} に突入した。",
        finalEnding: "5ターン終了。{ending} になった。",
        forcedRestNotice: "優君の気力が限界だ。次のターンは強制的に休むしかない。",
      },
      bubbles: {
        playerDefault: "瑞花をどう支えるか、まだ選べる。",
        playerRest: "……少し休んで立て直す。",
        rivalHighMotivation: "闘志は高い。あとは心の向きも噛み合わせたい。",
        rivalDefault: "気持ちの上下がまだ大きい。支え方が重要だ。",
      },
    },
  },
};
