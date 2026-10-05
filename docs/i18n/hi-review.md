# हिन्दी interface strings — for review

Generated from `apps/web/src/i18n/` (ADR-0061). Do not edit by hand: correct the catalogue,
then run `UPDATE_I18N_REVIEW=1 pnpm --filter @tc/web test` to rewrite this file.

**477** strings are translated; **2** are deliberately
left in English (listed at the end). The language stays marked “(बीटा)” until a native speaker
has read every row below (docs/PENDING.md).

What to check, row by row: is it natural, simple language an Indian PhD student would expect?
Are the academic words the ones universities actually use (थीसिस or शोध-प्रबंध, साइटेशन or
उद्धरण)? Does a button read as an action? `{name}` placeholders must stay exactly as written,
and product names (Assist, Draft, Thesis Copilot, APA 7, Word, Google, Razorpay) stay in
English. Write corrections in the last column.

## Shared words

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `common.theses` | Theses | थीसिस | |
| `common.loading` | Loading… | लोड हो रहा है… | |
| `common.saving` | Saving… | सेव हो रहा है… | |
| `common.sending` | Sending… | भेजा जा रहा है… | |
| `common.creating` | Creating… | बनाया जा रहा है… | |
| `common.cancel` | Cancel | रद्द करें | |
| `common.close` | Close | बंद करें | |
| `common.send` | Send | भेजें | |
| `common.delete` | Delete | हटाएँ | |
| `common.deleting` | Deleting… | हटाया जा रहा है… | |
| `common.dismiss` | Dismiss | हटाएँ | |
| `common.discard` | Discard | छोड़ दें | |
| `common.more` | More | और | |
| `common.on` | On | चालू | |
| `common.off` | Off | बंद | |
| `common.neverMind` | Never mind | रहने दें | |
| `common.thisMonth` | This month | इस महीने | |
| `common.notIncluded` | Not included in your plan: {list}. | आपके प्लान में शामिल नहीं: {list}। | |
| `common.workingTitle` | Working title | कार्यकारी शीर्षक | |
| `common.help` | Help | मदद | |
| `common.settings` | Settings | सेटिंग्स | |
| `common.account` | Account | अकाउंट | |
| `common.signOut` | Sign out | साइन आउट | |
| `common.admin` | Admin | एडमिन | |
| `common.privacy` | Privacy | गोपनीयता | |
| `common.pricing` | Pricing | कीमतें | |
| `common.edit` | Edit | बदलें | |
| `common.findPapers` | Find papers | पेपर खोजें | |

## The thesis list

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `list.entry.paper` | A paper I have written | मेरा लिखा हुआ एक पेपर | |
| `list.entry.paperHint` | It reads the paper and builds the proposal around it | यह पेपर पढ़कर उसी के आधार पर प्रस्ताव तैयार करता है | |
| `list.entry.topic` | A topic | एक विषय | |
| `list.entry.topicHint` | It checks the literature and helps you find the gap | यह साहित्य देखता है और शोध-अंतराल (gap) खोजने में मदद करता है | |
| `list.loadError` | Could not load your documents. | आपके दस्तावेज़ लोड नहीं हो सके। | |
| `list.createError` | Could not create the document. | दस्तावेज़ नहीं बन सका। | |
| `list.deleteError` | Could not delete the thesis. Try again. | थीसिस हटाई नहीं जा सकी। फिर से कोशिश करें। | |
| `list.copyError` | Could not copy the thesis. Try again. | थीसिस की कॉपी नहीं बन सकी। फिर से कोशिश करें। | |
| `list.stage.proposal` | Proposal | प्रस्ताव | |
| `list.stage.sources` | Sources | स्रोत | |
| `list.stage.outline` | Outline | रूपरेखा | |
| `list.stage.review` | Review | समीक्षा | |
| `list.stage.submit` | Submit | जमा करें | |
| `list.stage.build` | Build a chapter | अध्याय तैयार करें | |
| `list.stage.journals` | Journals | जर्नल | |
| `list.stage.viva` | Viva practice | वाइवा अभ्यास | |
| `list.titlePlaceholder` | e.g. Low-cost solar dryers for smallholder farms | जैसे: छोटे किसानों के लिए कम लागत वाले सोलर ड्रायर | |
| `list.startFrom` | Start from | शुरुआत कहाँ से | |
| `list.create` | Create thesis with a proposal | प्रस्ताव के साथ थीसिस बनाएँ | |
| `list.startWriting` | Start writing now | अभी लिखना शुरू करें | |
| `list.startWritingHint` | Start writing now opens your first chapter straight away and starts finding papers on your title while you write. The proposal (a few questions that plan your chapters) can come first, or later from the editor. | अभी लिखना शुरू करें से आपका पहला अध्याय तुरंत खुलता है और आपके लिखते-लिखते आपके शीर्षक पर पेपर खोजे जाने लगते हैं। प्रस्ताव (कुछ सवाल जो आपके अध्यायों की योजना बनाते हैं) पहले भी हो सकता है, या बाद में एडिटर से। | |
| `list.title` | Your theses | आपकी थीसिस | |
| `list.lede` | Each one keeps its own sources, outline and citation style. | हर थीसिस के अपने स्रोत, रूपरेखा और साइटेशन शैली होती है। | |
| `list.startFromPaper` | Start from a paper | पेपर से शुरू करें | |
| `list.continueWriting` | Continue writing | लिखना जारी रखें | |
| `list.firstRun` | Step 1 of 3: name the thesis and say whether it grows from a paper you have written. You can change the title later; nothing here is final. | चरण 1/3: थीसिस का नाम दें और बताएँ कि क्या यह आपके लिखे किसी पेपर से निकली है। शीर्षक बाद में बदल सकते हैं; यहाँ कुछ भी अंतिम नहीं है। | |
| `list.emptyTitle` | No theses yet | अभी कोई थीसिस नहीं | |
| `list.emptyBody` | Give one a working title above. You can rename it at any point. | ऊपर एक कार्यकारी शीर्षक दें। नाम कभी भी बदल सकते हैं। | |
| `list.countOne` | {count} thesis | {count} थीसिस | |
| `list.countMany` | {count} theses | {count} थीसिस | |
| `list.fromPaper` | From a paper | पेपर से | |
| `list.fromTopic` | From a topic | विषय से | |
| `list.updated` | updated {date} | अपडेट: {date} | |
| `list.write` | Write | लिखें | |
| `list.copying` | Copying… | कॉपी बन रही है… | |
| `list.makeCopy` | Make a copy | कॉपी बनाएँ | |
| `list.deleteAria` | Delete “{title}” | “{title}” हटाएँ | |
| `list.startAnother` | Start another thesis | नई थीसिस शुरू करें | |
| `list.deleteTitle` | Delete this thesis? | यह थीसिस हटाएँ? | |
| `list.deleteBody` | “{title}”, with its chapters, sources, versions and files, is removed for good. Export a copy first if you want one. | “{title}” अपने अध्यायों, स्रोतों, संस्करणों और फ़ाइलों के साथ हमेशा के लिए हट जाएगी। चाहें तो पहले एक कॉपी एक्सपोर्ट कर लें। | |
| `list.exportFirst` | Export .docx first | पहले .docx एक्सपोर्ट करें | |

## New thesis

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `new.crumb` | New | नई | |
| `new.heading` | Where does this thesis start? | यह थीसिस कहाँ से शुरू होगी? | |
| `new.startingPoint` | Starting point | शुरुआत | |
| `new.paper.name` | Start from a paper I have written | अपने लिखे पेपर से शुरू करें | |
| `new.paper.line` | Upload it; the proposal, glossary and starting library are read out of it. | पेपर अपलोड करें; प्रस्ताव, शब्दावली और शुरुआती लाइब्रेरी उसी से तैयार होती है। | |
| `new.paper.next` | You will upload the paper next. | अगले चरण में आप पेपर अपलोड करेंगे। | |
| `new.topic.name` | Start from a topic | एक विषय से शुरू करें | |
| `new.topic.line` | A short conversation — two or three questions — narrows it into a proposal skeleton. | दो-तीन सवालों की छोटी बातचीत से विषय एक प्रस्ताव के ढाँचे में बदल जाता है। | |
| `new.topic.next` | You will describe the topic in a sentence next. | अगले चरण में आप विषय को एक वाक्य में बताएँगे। | |
| `new.placeholderTopic` | e.g. Drip irrigation uptake among smallholders | जैसे: छोटे किसानों में ड्रिप सिंचाई को अपनाना | |
| `new.placeholderPaper` | e.g. the title of your paper | जैसे: आपके पेपर का शीर्षक | |
| `new.titleLater` | You can change the title later. | शीर्षक बाद में बदल सकते हैं। | |
| `new.createError` | Could not create it. | यह नहीं बन सका। | |
| `new.continue` | Continue | आगे बढ़ें | |
| `new.createImport` | Create and import from Word | बनाएँ और Word से इम्पोर्ट करें | |
| `new.wordHint` | Already writing in Word? Import brings each Heading 1 in as a chapter; the proposal can wait. | पहले से Word में लिख रहे हैं? इम्पोर्ट हर Heading 1 को एक अध्याय बना देता है; प्रस्ताव बाद में भी हो सकता है। | |

## Starting citation style

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `style.legend` | Citation style | साइटेशन शैली | |
| `style.optional` | (optional) | (वैकल्पिक) | |
| `style.other` | Other… | अन्य… | |
| `style.hintOther` | Once the thesis is created, choose from about ten thousand styles in the editor’s Citations tab. Until then it uses APA 7. | थीसिस बनने के बाद, एडिटर के Citations टैब में लगभग दस हज़ार शैलियों में से चुनें। तब तक APA 7 लागू रहेगी। | |
| `style.hintDefault` | The five most asked for. Skip it to keep APA 7; you can change it at any time and every citation follows. | सबसे ज़्यादा माँगी जाने वाली पाँच शैलियाँ। छोड़ दें तो APA 7 रहेगी; आप इसे कभी भी बदल सकते हैं और हर साइटेशन उसी के अनुसार बदल जाएगा। | |

## The proposal screen

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `proposal.loadError` | Could not load this proposal. | यह प्रस्ताव लोड नहीं हो सका। | |
| `proposal.uploadError` | That upload did not work. | अपलोड नहीं हो सका। | |
| `proposal.saveError` | Could not save the proposal. | प्रस्ताव सेव नहीं हो सका। | |
| `proposal.back` | Back to your theses | अपनी थीसिस पर वापस जाएँ | |
| `proposal.crumb` | Proposal | प्रस्ताव | |
| `proposal.headingTopic` | Turn your topic into a thesis proposal | अपने विषय को थीसिस प्रस्ताव में बदलें | |
| `proposal.headingPaper` | Turn your paper into a thesis proposal | अपने पेपर को थीसिस प्रस्ताव में बदलें | |
| `proposal.ledeTopic` | A short conversation narrows the topic; the skeleton it ends in is yours to edit. What you write here is what the AI reads later, never the version it drafted. | एक छोटी बातचीत विषय को सीमित करती है; अंत में जो ढाँचा बनता है, उसे आप बदल सकते हैं। AI बाद में वही पढ़ता है जो आप यहाँ लिखते हैं, उसका अपना मसौदा कभी नहीं। | |
| `proposal.ledePaper` | Everything below is a starting point taken from your paper. Edit any of it. What you write here is what the AI reads later, never the version it drafted. | नीचे सब कुछ आपके पेपर से लिया गया एक शुरुआती बिंदु है। इसमें कुछ भी बदलें। AI बाद में वही पढ़ता है जो आप यहाँ लिखते हैं, उसका अपना मसौदा कभी नहीं। | |
| `proposal.firstRun` | Step 2 of 3: upload the paper. It is read once, and its references become your starting library. This takes a minute or two. | चरण 2/3: पेपर अपलोड करें। इसे एक बार पढ़ा जाता है, और इसके संदर्भ आपकी शुरुआती लाइब्रेरी बन जाते हैं। इसमें एक-दो मिनट लगते हैं। | |
| `proposal.byHand` | Fill it in myself instead | इसके बजाय मैं खुद भरूँगा | |
| `proposal.continue` | Continue to the editor | एडिटर पर जाएँ | |
| `proposal.buildOutline` | Build the outline | रूपरेखा बनाएँ | |
| `proposal.findPapers` | Find papers for this topic | इस विषय पर पेपर खोजें | |
| `proposal.seeSources` | See the sources found in your paper | आपके पेपर में मिले स्रोत देखें | |
| `proposal.couldNotBeReadLower` | could not be read | पढ़ा नहीं जा सका | |
| `proposal.couldNotBeRead` | Could not be read | पढ़ा नहीं जा सका | |
| `proposal.tryAnother` | Try another file. | कोई दूसरी फ़ाइल आज़माएँ। | |
| `proposal.uploadPrompt` | Upload the paper this thesis grows from. | वह पेपर अपलोड करें जिससे यह थीसिस निकली है। | |
| `proposal.fileKinds` | A PDF or Word file. Yours, or one you have written. | PDF या Word फ़ाइल। आपका अपना, या जिसे आपने लिखा है। | |
| `proposal.uploading` | Uploading… | अपलोड हो रहा है… | |
| `proposal.chooseFile` | Choose a file | फ़ाइल चुनें | |
| `proposal.read` | Read | पढ़ लिया | |
| `proposal.reading` | Reading your paper… | आपका पेपर पढ़ा जा रहा है… | |
| `proposal.problem` | Problem statement | समस्या कथन | |
| `proposal.problemHint` | Two or three sentences on what the thesis is about. | दो-तीन वाक्यों में बताएँ कि थीसिस किस बारे में है। | |
| `proposal.objectives` | Objectives | उद्देश्य | |
| `proposal.objectivesHint` | What the thesis sets out to establish. | थीसिस क्या स्थापित करना चाहती है। | |
| `proposal.objective` | Objective {n} | उद्देश्य {n} | |
| `proposal.removeObjective` | Remove objective {n} | उद्देश्य {n} हटाएँ | |
| `proposal.addObjective` | Add an objective | एक उद्देश्य जोड़ें | |
| `proposal.whyOpen` | Why this is not yet fully answered | इसका पूरा उत्तर अभी तक क्यों नहीं मिला | |
| `proposal.whyOpenHint` | The gap your thesis fills. Write this yourself; it is the part a committee reads closely. | वह अंतराल जिसे आपकी थीसिस भरती है। इसे खुद लिखें; समिति इसी हिस्से को ध्यान से पढ़ती है। | |
| `proposal.whyOpenPlaceholder` | The existing work stops at… | मौजूदा काम यहाँ तक ही पहुँचता है… | |
| `proposal.gapTitle` | What a thesis needs that this paper does not have | थीसिस को क्या चाहिए जो इस पेपर में नहीं है | |
| `proposal.gapHint` | Tick these off as you go. Nothing here blocks you. | जैसे-जैसे पूरा हो, इन पर निशान लगाएँ। इनमें से कुछ भी आपको रोकता नहीं। | |

## The topic conversation (proposal)

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `pathA.loadError` | Could not load the conversation. | बातचीत लोड नहीं हो सकी। | |
| `pathA.sendError` | That did not send. Try again. | संदेश नहीं गया। फिर से कोशिश करें। | |
| `pathA.introOne` | Describe the topic in a sentence or two. You will be asked one question before a proposal skeleton is drafted — and you edit every word of it. | विषय को एक-दो वाक्यों में बताइए। प्रस्ताव का ढाँचा बनने से पहले आपसे एक सवाल पूछा जाएगा — और उसका हर शब्द आप बदल सकते हैं। | |
| `pathA.introMany` | Describe the topic in a sentence or two. You will be asked up to {n} questions before a proposal skeleton is drafted — and you edit every word of it. | विषय को एक-दो वाक्यों में बताइए। प्रस्ताव का ढाँचा बनने से पहले आपसे अधिकतम {n} सवाल पूछे जाएँगे — और उसका हर शब्द आप बदल सकते हैं। | |
| `pathA.chooseAnswer` | Choose an answer | एक उत्तर चुनें | |
| `pathA.typeBelow` | {option} — type it below | {option} — नीचे लिखें | |
| `pathA.thinking` | Thinking… | सोच रहा है… | |
| `pathA.editingDone` | Changing an earlier answer. What came after it is asked again, and the proposal below is redrafted. | आप पहले का एक उत्तर बदल रहे हैं। उसके बाद के सवाल फिर से पूछे जाएँगे, और नीचे का प्रस्ताव दोबारा बनेगा। | |
| `pathA.editing` | Changing an earlier answer. What came after it is asked again. | आप पहले का एक उत्तर बदल रहे हैं। उसके बाद के सवाल फिर से पूछे जाएँगे। | |
| `pathA.yourMessage` | Your message | आपका संदेश | |
| `pathA.examplePlaceholder` | e.g. {example} | जैसे: {example} | |
| `pathA.chooseOrType` | Choose above, or type your own answer… | ऊपर से चुनें, या अपना उत्तर लिखें… | |
| `pathA.yourAnswer` | Your answer… | आपका उत्तर… | |
| `pathA.asked` | {asked} of {max} questions asked | {max} में से {asked} सवाल पूछे गए | |
| `pathA.skeletonReady` |  · skeleton ready below |  · ढाँचा नीचे तैयार है | |
| `pathA.relatedWork` | Related work | संबंधित काम | |
| `pathA.appearsAfter` | Appears after your first answer. | आपके पहले उत्तर के बाद दिखेगा। | |

## The editor

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `editor.status.idle` | Saved | सेव हो गया | |
| `editor.status.dirty` | Unsaved changes | बदलाव सेव नहीं हुए | |
| `editor.status.saving` | Saving… | सेव हो रहा है… | |
| `editor.status.saved` | Saved | सेव हो गया | |
| `editor.status.conflict` | Changed elsewhere | कहीं और बदला गया | |
| `editor.status.error` | Save failed — retrying | सेव नहीं हुआ — फिर कोशिश हो रही है | |
| `editor.live.reconnecting` | Reconnecting… | फिर से जुड़ रहा है… | |
| `editor.live.connecting` | Connecting… | जुड़ रहा है… | |
| `editor.live.live` | Live | लाइव | |
| `editor.live.with` | Live with {names} | {names} के साथ लाइव | |
| `editor.loadError` | Could not load the chapter. | अध्याय लोड नहीं हो सका। | |
| `editor.loadingChapter` | Loading chapter… | अध्याय लोड हो रहा है… | |
| `editor.history` | History | इतिहास | |
| `editor.howSuggestions` | How suggestions work | सुझाव कैसे काम करते हैं | |
| `editor.feedback` | Feedback | फ़ीडबैक | |
| `editor.download` | Download {file} | {file} डाउनलोड करें | |
| `editor.exportTitle` | Plain .docx of this chapter (FR-8.1) | इस अध्याय की सादी .docx फ़ाइल (FR-8.1) | |
| `editor.exportError` | The export did not complete. Try again in a minute. | एक्सपोर्ट पूरा नहीं हुआ। एक मिनट बाद फिर कोशिश करें। | |
| `editor.exporting` | Exporting… | एक्सपोर्ट हो रहा है… | |
| `editor.export` | Export .docx | .docx एक्सपोर्ट करें | |
| `editor.conflictBanner` | This chapter was changed elsewhere — reload to continue. Autosave is paused. | यह अध्याय कहीं और बदला गया है — आगे बढ़ने के लिए पेज रीलोड करें। ऑटोसेव रुका हुआ है। | |
| `editor.reload` | Reload | रीलोड करें | |
| `editor.restoreBanner` | An older version of this chapter is back. What you had before is saved as a version. | इस अध्याय का पुराना संस्करण वापस आ गया है। पहले जो था, वह एक संस्करण के रूप में सेव है। | |
| `editor.undoing` | Undoing… | पूर्ववत हो रहा है… | |
| `editor.undo` | Undo | पूर्ववत करें | |
| `editor.undoError` | The undo did not complete. The version is still in History. | पूर्ववत पूरा नहीं हुआ। वह संस्करण अब भी इतिहास में है। | |
| `editor.localDraft` | Unsaved changes from {time} were found in this browser. | इस ब्राउज़र में {time} के बिना सेव किए बदलाव मिले हैं। | |
| `editor.restore` | Restore | वापस लाएँ | |
| `editor.chapters` | Chapters | अध्याय | |
| `editor.outline` | Outline | रूपरेखा | |
| `editor.outlineBuilding` | Building your chapters from the proposal… they appear here in a minute. | प्रस्ताव से आपके अध्याय बन रहे हैं… एक मिनट में यहाँ दिखेंगे। | |
| `editor.hint.intro` | This is your chapter. Write as you normally would. | यह आपका अध्याय है। जैसे हमेशा लिखते हैं, वैसे ही लिखें। | |
| `editor.hint.auto` | A suggestion appears when you pause | जब आप रुकते हैं, एक सुझाव दिखता है | |
| `editor.hint.manual` | Press Suggest, below, when you want a suggestion | जब सुझाव चाहिए, नीचे Suggest दबाएँ | |
| `editor.hint.orKey` | (or {key}) | (या {key}) | |
| `editor.hint.stop` | . | । | |
| `editor.hint.keys` | {tab} keeps it and {esc} dismisses it. | {tab} से सुझाव रखें और {esc} से हटाएँ। | |
| `editor.hint.cites` | It cites only the papers in your library. | यह सिर्फ़ आपकी लाइब्रेरी के पेपर ही साइट करता है। | |
| `editor.hint.how` | How suggestions work (90 seconds) | सुझाव कैसे काम करते हैं (90 सेकंड) | |
| `editor.closeMessage` | Close message | संदेश बंद करें | |
| `editor.key.suggestion` | suggestion | सुझाव | |
| `editor.key.accept` | accept | स्वीकार | |
| `editor.key.word` | a word | एक शब्द | |
| `editor.key.guided` | guided | निर्देश के साथ | |
| `editor.key.dismiss` | dismiss | हटाएँ | |
| `editor.key.draft` | draft a section | एक खंड का मसौदा | |
| `editor.key.cite` | cite | साइट करें | |
| `editor.key.snapshot` | snapshot | स्नैपशॉट | |
| `editor.tools` | Tools | टूल | |
| `editor.tab.sources` | sources | स्रोत | |
| `editor.tab.papers` | papers | पेपर | |
| `editor.tab.citations` | citations | साइटेशन | |
| `editor.tab.chat` | chat | चैट | |
| `editor.tab.flags` | flags | फ़्लैग | |
| `editor.tab.review` | review | समीक्षा | |
| `editor.chapterAndTools` | Chapter and tools | अध्याय और टूल | |
| `editor.feedbackLabel` | What happened? The admin gets this note, this document’s id and your last five suggestion events — not your text. | क्या हुआ? एडमिन को यह नोट, इस दस्तावेज़ की id और आपके पिछले पाँच सुझावों का ब्योरा मिलता है — आपका लिखा हुआ नहीं। | |
| `editor.feedbackSent` | Thanks — your note is on its way, with the ids of your last few suggestions. | धन्यवाद — आपका नोट आपके पिछले कुछ सुझावों की ids के साथ भेज दिया गया है। | |
| `editor.feedbackFailed` | The note did not send. Try again in a minute. | नोट नहीं गया। एक मिनट बाद फिर कोशिश करें। | |
| `editor.snapshotSaved` | Snapshot saved | स्नैपशॉट सेव हो गया | |
| `editor.snapshotFailed` | Snapshot failed | स्नैपशॉट सेव नहीं हुआ | |
| `editor.notice.serviceDown` | The suggestion service did not answer twice in a row. Your writing is saved; try again in a minute. | सुझाव सेवा ने लगातार दो बार जवाब नहीं दिया। आपका लिखा सेव है; एक मिनट बाद फिर कोशिश करें। | |
| `editor.notice.findingSources` | No source in your library covers this yet{gap}. We are finding papers on it and adding them to your library now — ask again in a minute for cited text. | आपकी लाइब्रेरी का कोई स्रोत अभी इसे कवर नहीं करता{gap}। हम इस पर पेपर खोजकर आपकी लाइब्रेरी में जोड़ रहे हैं — साइटेशन वाले टेक्स्ट के लिए एक मिनट बाद फिर पूछें। | |
| `editor.notice.papersLoading` | Your papers are still being read, so there is nothing to cite yet. Your first cited suggestion will appear here by itself as soon as one is ready. | आपके पेपर अभी पढ़े जा रहे हैं, इसलिए अभी साइट करने को कुछ नहीं है। जैसे ही एक तैयार होगा, आपका पहला साइटेशन वाला सुझाव यहीं अपने आप आ जाएगा। | |
| `editor.filling.searching` | Finding papers on your topic… | आपके विषय पर पेपर खोजे जा रहे हैं… | |
| `editor.filling.reading` | Found {found} papers · reading {reading}… | {found} पेपर मिले · {reading} पढ़े जा रहे हैं… | |
| `editor.filling.ready` | {ready} papers ready — suggestions will cite them. | {ready} पेपर तैयार — सुझाव अब इन्हें साइट करेंगे। | |

## guide

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `guide.title` | Getting started | शुरुआत | |
| `guide.write` | Write | लिखें | |
| `guide.writeDetail` | Start with a sentence or two of your own — what this chapter is about. Rough is fine. | अपने एक-दो वाक्यों से शुरू करें — यह अध्याय किस बारे में है। कच्चा लिखना भी ठीक है। | |
| `guide.suggest` | Take a suggestion | एक सुझाव लें | |
| `guide.suggestDetail` | Press Suggest (or pause while typing). The grey text cites your library: Tab keeps it, Esc dismisses it. | सुझाव दबाएँ (या लिखते हुए रुकें)। धूसर टेक्स्ट आपकी लाइब्रेरी को साइट करता है: Tab से रखें, Esc से हटाएँ। | |
| `guide.sources` | See your papers | अपने पेपर देखें | |
| `guide.sourcesDetail` | We are finding papers on your title and reading them. Look them over — suggestions can only cite what is in your library. | हम आपके शीर्षक पर पेपर खोजकर पढ़ रहे हैं। उन्हें देख लें — सुझाव सिर्फ़ आपकी लाइब्रेरी के पेपर ही साइट कर सकते हैं। | |
| `guide.sourcesAction` | Show papers | पेपर दिखाएँ | |
| `guide.plan` | Plan your chapters | अध्यायों की योजना बनाएँ | |
| `guide.planDetail` | Answer a few questions and get a chapter outline, so each chapter is written to a plan. | कुछ सवालों के जवाब दें और अध्यायों की रूपरेखा पाएँ, ताकि हर अध्याय योजना के अनुसार लिखा जाए। | |
| `guide.planAction` | Plan chapters | अध्याय योजना | |
| `guide.hide` | Hide | छिपाएँ | |

## The editor

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `editor.notice.needsSource` | No source in your library covers this yet{gap}. Find papers on it to continue. | आपकी लाइब्रेरी का कोई स्रोत अभी इसे कवर नहीं करता{gap}। आगे बढ़ने के लिए इस पर पेपर खोजें। | |
| `editor.notice.emptyLibrary` | Your library has nothing to cite yet, so there was no suggestion. Find papers for this thesis first. | आपकी लाइब्रेरी में साइट करने के लिए अभी कुछ नहीं है, इसलिए कोई सुझाव नहीं बना। पहले इस थीसिस के लिए पेपर खोजें। | |
| `editor.notice.noSources` | That suggestion had no sources to draw on. Find papers to get cited text. | उस सुझाव के पास आधार बनाने के लिए कोई स्रोत नहीं था। साइटेशन वाले टेक्स्ट के लिए पेपर खोजें। | |
| `editor.notice.noPinnedMatch` | None of the pinned sources matched this passage, so the suggestion cites nothing. | पिन किए गए स्रोतों में से कोई भी इस अंश से मेल नहीं खाता, इसलिए सुझाव कुछ साइट नहीं करता। | |
| `editor.notice.empty` | No suggestion this time. Write a sentence or two of your own, then ask again. | इस बार कोई सुझाव नहीं। अपने एक-दो वाक्य लिखें, फिर दोबारा पूछें। | |
| `editor.notice.chatAdded` | Added to the chapter. Read it through — it is marked as AI-written. | अध्याय में जोड़ दिया गया। इसे पूरा पढ़ें — इस पर AI-लिखित का निशान है। | |
| `editor.notice.flagSelected` | Selected the flagged text. Use the toolbar above it to rewrite — the flag says: {flag} | फ़्लैग किया गया टेक्स्ट चुन लिया गया है। दोबारा लिखने के लिए उसके ऊपर का टूलबार इस्तेमाल करें — फ़्लैग कहता है: {flag} | |

## The formatting toolbar (tooltips)

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `fmt.toolbar` | Formatting | फ़ॉर्मेटिंग | |
| `fmt.undo` | Undo | पूर्ववत करें | |
| `fmt.redo` | Redo | फिर से करें | |
| `fmt.bold` | Bold (Ctrl+B) | बोल्ड (Ctrl+B) | |
| `fmt.italic` | Italic (Ctrl+I) | इटैलिक (Ctrl+I) | |
| `fmt.underline` | Underline (Ctrl+U) | रेखांकित (Ctrl+U) | |
| `fmt.strike` | Strikethrough | काटी हुई रेखा | |
| `fmt.superscript` | Superscript | सुपरस्क्रिप्ट | |
| `fmt.subscript` | Subscript | सबस्क्रिप्ट | |
| `fmt.inlineCode` | Inline code | इनलाइन कोड | |
| `fmt.codeBlock` | Code block | कोड ब्लॉक | |
| `fmt.bulletList` | Bulleted list | बुलेट सूची | |
| `fmt.orderedList` | Numbered list | क्रमांकित सूची | |
| `fmt.blockquote` | Block quote | उद्धरण ब्लॉक | |
| `fmt.editLink` | Edit link | लिंक बदलें | |
| `fmt.addLink` | Add link | लिंक जोड़ें | |
| `fmt.removeLink` | Remove link | लिंक हटाएँ | |
| `fmt.insertTable` | Insert table | तालिका जोड़ें | |
| `fmt.referTo` | Refer to a figure or table | किसी चित्र या तालिका का हवाला दें | |
| `fmt.referToOption` | Refer to… | हवाला दें… | |
| `fmt.figureN` | Figure {n} | चित्र {n} | |
| `fmt.tableN` | Table {n} | तालिका {n} | |
| `fmt.equation` | Equation (LaTeX) | समीकरण (LaTeX) | |
| `fmt.displayEquation` | Display equation | अलग पंक्ति में समीकरण | |
| `fmt.editFootnote` | Edit footnote | फ़ुटनोट बदलें | |
| `fmt.footnote` | Footnote | फ़ुटनोट | |
| `fmt.insertFigure` | Insert figure | चित्र जोड़ें | |
| `fmt.editChart` | Edit chart | चार्ट बदलें | |
| `fmt.insertChart` | Insert chart | चार्ट जोड़ें | |
| `fmt.chart` | Chart | चार्ट | |
| `fmt.editDiagram` | Edit diagram | आरेख बदलें | |
| `fmt.insertDiagram` | Insert diagram | आरेख जोड़ें | |
| `fmt.diagram` | Diagram | आरेख | |
| `fmt.caption` | Caption | कैप्शन | |
| `fmt.table` | Table | तालिका | |
| `fmt.rowAbove` | Row above | ऊपर पंक्ति | |
| `fmt.rowBelow` | Row below | नीचे पंक्ति | |
| `fmt.columnLeft` | Column left | बाएँ कॉलम | |
| `fmt.columnRight` | Column right | दाएँ कॉलम | |
| `fmt.mergeCells` | Merge cells | सेल मिलाएँ | |
| `fmt.merge` | Merge | मिलाएँ | |
| `fmt.splitCell` | Split cell | सेल बाँटें | |
| `fmt.split` | Split | बाँटें | |
| `fmt.headerRow` | Header row | हेडर पंक्ति | |
| `fmt.header` | Header | हेडर | |
| `fmt.deleteRow` | Delete row | पंक्ति हटाएँ | |
| `fmt.deleteColumn` | Delete column | कॉलम हटाएँ | |
| `fmt.deleteTable` | Delete table | तालिका हटाएँ | |
| `fmt.textStyle` | Text style | टेक्स्ट शैली | |
| `fmt.style.text` | Text | सामान्य टेक्स्ट | |
| `fmt.style.heading` | Heading | शीर्षक | |
| `fmt.style.subheading` | Subheading | उपशीर्षक | |
| `fmt.style.quote` | Quote | उद्धरण | |

## The suggestion bar

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `suggest.floating` | Suggest a continuation | आगे का सुझाव दें | |
| `suggest.suggestion` | Suggestion | सुझाव | |
| `suggest.writing` | Writing… | लिखा जा रहा है… | |
| `suggest.previous` | Previous suggestion | पिछला सुझाव | |
| `suggest.next` | Next suggestion | अगला सुझाव | |
| `suggest.position` | {n} of {total} | {total} में से {n} | |
| `suggest.evidence` | Evidence: | प्रमाण: | |
| `suggest.source` | source | स्रोत | |
| `suggest.accept` | Accept | स्वीकार करें | |
| `suggest.oneWord` | One word | एक शब्द | |
| `suggest.refine` | Refine | सुधारें | |
| `suggest.useful` | Useful suggestion | उपयोगी सुझाव | |
| `suggest.notUseful` | Not a useful suggestion | उपयोगी सुझाव नहीं | |
| `suggest.opening` | Opening the passage… | अंश खुल रहा है… | |
| `suggest.couldNotOpen` | This passage could not be opened. | यह अंश खोला नहीं जा सका। | |
| `suggest.fullText` | We hold the full text of this paper. | इस पेपर का पूरा टेक्स्ट हमारे पास है। | |
| `suggest.abstractOnly` | We hold only the abstract of this paper. | इस पेपर का सिर्फ़ सार (abstract) हमारे पास है। | |
| `suggest.page` | page {n} | पृष्ठ {n} | |
| `suggest.openPdf` | Open PDF | PDF खोलें | |
| `suggest.ownInstruction` | Your own instruction… | अपना निर्देश… | |
| `suggest.refineCost` | Each refined suggestion uses one of your Assist suggestions. | हर सुधारा गया सुझाव आपके Assist सुझावों में से एक गिना जाता है। | |
| `suggest.preset.shorter` | Shorter | छोटा करें | |
| `suggest.preset.formal` | More formal | और औपचारिक | |
| `suggest.preset.onTopic` | Stay closer to my topic | मेरे विषय के और करीब रहें | |
| `suggest.preset.complete` | Complete this paragraph | यह अनुच्छेद पूरा करें | |
| `suggest.preset.contrast` | A contrasting finding | एक विपरीत निष्कर्ष | |

## The selection toolbar

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `command.expand` | Expand | विस्तार करें | |
| `command.formalise` | Formalise | औपचारिक बनाएँ | |
| `command.simplify` | Simplify | सरल करें | |
| `command.shorten` | Shorten | छोटा करें | |
| `command.consistency` | Check consistency | संगति जाँचें | |
| `command.working` | Working… | काम चल रहा है… | |
| `command.comment` | Comment | टिप्पणी | |
| `command.askChat` | Ask chat | चैट से पूछें | |
| `command.wordsSelected` | {n} words selected | {n} शब्द चुने गए | |
| `command.costNote` |  · each uses one of your section commands this month |  · हर एक इस महीने के आपके सेक्शन कमांड में से एक गिना जाता है | |
| `command.nothingChanges` | Nothing changes until you press Replace or Insert below. | जब तक आप नीचे “बदल दें” या “नीचे जोड़ें” नहीं दबाते, कुछ नहीं बदलता। | |
| `command.tryAgain` | Try again | फिर से कोशिश करें | |
| `command.insertBelow` | Insert below | नीचे जोड़ें | |
| `command.replace` | Replace | बदल दें | |
| `command.commentLabel` | Your comment on the selected text | चुने गए टेक्स्ट पर आपकी टिप्पणी | |
| `command.commentPlaceholder` | e.g. check this figure against the 2023 report | जैसे: इस आँकड़े को 2023 की रिपोर्ट से मिलाएँ | |
| `command.saveComment` | Save comment | टिप्पणी सेव करें | |
| `command.commentAdded` | Comment added. It is listed under Review, on the passage. | टिप्पणी जुड़ गई। यह समीक्षा में, उसी अंश पर दिखती है। | |
| `command.commentFailed` | The comment was not saved. Try again. | टिप्पणी सेव नहीं हुई। फिर से कोशिश करें। | |
| `command.noConflict` | Nothing conflicted with the section or your glossary; the text is unchanged. | खंड या आपकी शब्दावली से कुछ भी टकराता नहीं; टेक्स्ट नहीं बदला। | |
| `command.failed` | That command did not run. | वह कमांड नहीं चला। | |
| `command.resultWords` | {command} · {from} → {to} words | {command} · {from} → {to} शब्द | |
| `command.droppedOne` | {n} citation in the selection are missing from the rewrite. Check the claims they supported before applying. | चुने गए हिस्से का {n} साइटेशन नए रूप में नहीं है। लागू करने से पहले उन दावों को जाँच लें जिनका वह समर्थन करता था। | |
| `command.droppedMany` | {n} citations in the selection are missing from the rewrite. Check the claims they supported before applying. | चुने गए हिस्से के {n} साइटेशन नए रूप में नहीं हैं। लागू करने से पहले उन दावों को जाँच लें जिनका वे समर्थन करते थे। | |

## Settings

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `settings.loadError` | Could not load your settings. | आपकी सेटिंग्स लोड नहीं हो सकीं। | |
| `settings.saveError` | Could not save. | सेव नहीं हो सका। | |
| `settings.language` | Interface language | इंटरफ़ेस की भाषा | |
| `settings.languageBody` | The language of the menus, buttons and labels on your main screens. Hindi is in beta: anything not yet translated stays in English. It does not change the language your thesis is written in, or what the AI writes. | आपकी मुख्य स्क्रीन पर मेनू, बटन और लेबल की भाषा। हिन्दी अभी बीटा में है: जो हिस्सा अभी अनुवादित नहीं है, वह अंग्रेज़ी में रहेगा। इससे आपकी थीसिस की भाषा या AI जो लिखता है, वह नहीं बदलता। | |
| `settings.auto.title` | Suggest without my asking | मेरे पूछे बिना सुझाव दें | |
| `settings.auto.body` | When this is on, a suggestion appears about a second after you stop typing, instead of only when you press {key}. It never interrupts you mid-word, and it never fires while a suggestion is already showing. | यह चालू हो तो टाइप करना रोकने के लगभग एक सेकंड बाद सुझाव दिखता है, सिर्फ़ {key} दबाने पर नहीं। यह कभी किसी शब्द के बीच में नहीं टोकता, और जब एक सुझाव पहले से दिख रहा हो तब नया नहीं आता। | |
| `settings.auto.on` | It is on for you now. Turn it off here whenever you would rather ask for each suggestion yourself. | अभी यह आपके लिए चालू है। जब भी हर सुझाव खुद माँगना चाहें, इसे यहाँ बंद कर दें। | |
| `settings.auto.off` | It is off for you now. Turn it on here if you would like suggestions without asking. | अभी यह आपके लिए बंद है। बिना माँगे सुझाव चाहिए तो इसे यहाँ चालू करें। | |
| `settings.auto.costLabel` | What it costs: | इसकी कीमत: | |
| `settings.auto.cost` | every suggestion counts as one Assist action, whether you keep it or dismiss it — the same as pressing {key} yourself. Leaving this on typically spends the month's allowance several times faster. | हर सुझाव एक Assist गिना जाता है, चाहे आप उसे रखें या हटाएँ — ठीक वैसे ही जैसे खुद {key} दबाने पर। इसे चालू रखने से महीने का कोटा आम तौर पर कई गुना तेज़ी से खर्च होता है। | |
| `settings.auto.allowance` | You have used {used} of {cap} Assist suggestions this month — {remaining} left, resetting on {date}. | इस महीने आपने {cap} में से {used} Assist सुझाव इस्तेमाल किए हैं — {remaining} बाकी हैं, {date} को फिर से शुरू होंगे। | |
| `settings.saved` | Saved. It takes effect the next time you open a chapter. | सेव हो गया। अगली बार अध्याय खोलने पर लागू होगा। | |
| `settings.cite.title` | Cite my library automatically | मेरी लाइब्रेरी से अपने-आप साइट करें | |
| `settings.cite.body` | On by default. When a suggestion draws on a paper in your library, it arrives with the citation already attached, so you can see which source it came from. | शुरू से चालू। जब कोई सुझाव आपकी लाइब्रेरी के किसी पेपर पर आधारित होता है, तो वह साइटेशन के साथ आता है, ताकि आप देख सकें कि वह किस स्रोत से आया। | |
| `settings.cite.groundedLabel` | Turning this off does not make suggestions less grounded. | इसे बंद करने से सुझाव कम प्रमाणित नहीं होते। | |
| `settings.cite.grounded` | Your sources are still what the suggestion is written from and it still may not claim anything they do not say — you simply get the sentence without the marker, and add the citation yourself. | सुझाव अब भी आपके स्रोतों से ही लिखा जाता है और वह ऐसा कुछ नहीं कह सकता जो स्रोतों में नहीं है — बस वाक्य बिना निशान के मिलता है, और साइटेशन आप खुद जोड़ते हैं। | |
| `settings.cite.cost` | Costs nothing either way. Citation {suggestions}, which you ask for with the cite button, are a separate action and are unaffected. | दोनों तरह से कोई खर्च नहीं। साइटेशन {suggestions}, जो आप cite बटन से माँगते हैं, एक अलग काम है और इस पर कोई असर नहीं पड़ता। | |
| `settings.cite.suggestionsWord` | suggestions | सुझाव | |
| `settings.sources.title` | Find sources for me | मेरे लिए स्रोत खोजें | |
| `settings.sources.body` | On by default. When nothing in your library covers what you are writing, we search OpenAlex, Semantic Scholar, arXiv and PubMed for papers on it and add the few that are clearly on topic to your library, marked “Added automatically”. Your suggestions can then cite them. | शुरू से चालू। जब आपकी लाइब्रेरी में आपके लिखे विषय पर कुछ नहीं होता, तो हम OpenAlex, Semantic Scholar, arXiv और PubMed पर उस विषय के पेपर खोजते हैं और साफ़ तौर पर विषय से जुड़े कुछ पेपर आपकी लाइब्रेरी में “Added automatically” निशान के साथ जोड़ देते हैं। फिर आपके सुझाव उन्हें साइट कर सकते हैं। | |
| `settings.sources.real` | Every paper added is a real, published record you can open and check, and you can remove any of them from your library. A few searches a month are included in your plan. | जोड़ा गया हर पेपर एक असली, प्रकाशित रिकॉर्ड है जिसे आप खोलकर जाँच सकते हैं, और किसी को भी अपनी लाइब्रेरी से हटा सकते हैं। महीने में कुछ खोजें आपके प्लान में शामिल हैं। | |
| `settings.email.title` | Email me when a long job finishes | लंबा काम पूरा होने पर मुझे ईमेल करें | |
| `settings.email.body` | On by default. A literature search, a chapter build, an examiner review or a coherence check can take a few minutes. If it runs for more than a minute and its page is not open, we send you one short email with a link to the result, so you can close the tab and come back when it is ready. | शुरू से चालू। साहित्य खोज, अध्याय तैयार करना, परीक्षक समीक्षा या संगति जाँच में कुछ मिनट लग सकते हैं। अगर काम एक मिनट से ज़्यादा चले और उसका पेज खुला न हो, तो हम नतीजे के लिंक के साथ एक छोटा ईमेल भेजते हैं, ताकि आप टैब बंद करके तैयार होने पर लौट सकें। | |
| `settings.style.title` | Citation style for new theses | नई थीसिस के लिए साइटेशन शैली | |
| `settings.style.body` | Chosen for you when you start a thesis; you can still change it there or in the Citations tab. Theses you already have keep their own style. | नई थीसिस शुरू करते समय यही चुनी जाती है; आप उसे वहाँ या Citations टैब में बदल सकते हैं। आपकी मौजूदा थीसिस अपनी शैली रखती हैं। | |
| `settings.style.default` | APA 7 (the default) | APA 7 (डिफ़ॉल्ट) | |
| `settings.contrast.title` | High contrast | हाई कंट्रास्ट | |
| `settings.contrast.body` | Darker text and stronger lines, in light or dark. Kept on this device only. | गहरा टेक्स्ट और मोटी रेखाएँ, लाइट या डार्क दोनों में। सिर्फ़ इसी डिवाइस पर रहता है। | |
| `settings.month.note` | Everything the AI does for you is counted here and nowhere else. Dismissing a suggestion still counts: the text was written before you saw it. | AI आपके लिए जो कुछ भी करता है, वह यहीं गिना जाता है, और कहीं नहीं। सुझाव हटाने पर भी वह गिना जाता है: आपके देखने से पहले टेक्स्ट लिखा जा चुका था। | |

## Account

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `account.loadError` | Could not load your plan. | आपका प्लान लोड नहीं हो सका। | |
| `account.checkoutError` | Could not start checkout. | भुगतान शुरू नहीं हो सका। | |
| `account.yourPlan` | Your plan | आपका प्लान | |
| `account.cancelled` | Cancelled — access continues until {date}. | रद्द किया गया — {date} तक इस्तेमाल कर सकते हैं। | |
| `account.pastDue` | Payment did not go through. You keep everything for three days after {date}, then move to the free allowances. Nothing is deleted. | भुगतान नहीं हो पाया। {date} के बाद तीन दिन तक सब कुछ आपके पास रहेगा, फिर आप मुफ़्त कोटे पर आ जाएँगे। कुछ भी हटाया नहीं जाता। | |
| `account.renews` | Renews on {date}. We will email you three days before. | {date} को रिन्यू होगा। हम तीन दिन पहले ईमेल करेंगे। | |
| `account.cancelConfirm` | Cancel your subscription? It will not renew. You keep everything until {date}, and your theses, sources and exports stay exactly as they are. | सब्सक्रिप्शन रद्द करें? यह रिन्यू नहीं होगा। {date} तक सब कुछ आपके पास रहेगा, और आपकी थीसिस, स्रोत और एक्सपोर्ट जैसे हैं वैसे ही रहेंगे। | |
| `account.cancelling` | Cancelling… | रद्द हो रहा है… | |
| `account.yesCancel` | Yes, cancel | हाँ, रद्द करें | |
| `account.keepIt` | Keep it | इसे रखें | |
| `account.cancelSubscription` | Cancel subscription | सब्सक्रिप्शन रद्द करें | |
| `account.plans` | Plans | प्लान | |
| `account.pilotNote` | During the pilot your allowances are set by hand — email us and we will move you. | पायलट के दौरान आपका कोटा हाथ से तय किया जाता है — हमें ईमेल करें, हम बदल देंगे। | |
| `account.perYear` |  / year |  / साल | |
| `account.perMonth` |  / month |  / महीना | |
| `account.choose` | Choose {plan} | {plan} चुनें | |
| `account.razorpay` | Payment is handled by Razorpay. We never see your card or UPI details. | भुगतान Razorpay के ज़रिए होता है। आपके कार्ड या UPI का ब्योरा हम कभी नहीं देखते। | |
| `account.refundPolicy` | Refund policy | रिफ़ंड नीति | |
| `account.resets` | Resets on {date}. A suggestion counts when it is generated, whether you keep it or dismiss it — the tokens were spent either way. Nothing you type counts. | {date} को फिर से शुरू होगा। सुझाव बनते ही गिना जाता है, चाहे आप उसे रखें या हटाएँ — टोकन दोनों हालत में खर्च हुए। आप जो खुद टाइप करते हैं, वह नहीं गिना जाता। | |
| `account.invoices` | Invoices | इनवॉइस | |
| `account.invoiceError` | That invoice could not be produced. | वह इनवॉइस नहीं बन सका। | |
| `account.emailTitle` | Email address | ईमेल पता | |
| `account.signInWith` | You sign in with {email}. | आप {email} से साइन इन करते हैं। | |
| `account.emailWithPassword` | The code we email you and your password both belong to this address, so changing it changes how you sign in. Move it before you lose access to a university mailbox. | हम जो कोड ईमेल करते हैं और आपका पासवर्ड, दोनों इसी पते से जुड़े हैं, इसलिए इसे बदलने से साइन इन का तरीका बदल जाता है। यूनिवर्सिटी का मेलबॉक्स बंद होने से पहले पता बदल लें। | |
| `account.emailNoPassword` | There is no password on this account — the code we email you is how you get in. So changing this address changes how you sign in. Move it before you lose access to a university mailbox. | इस अकाउंट पर कोई पासवर्ड नहीं है — हम जो कोड ईमेल करते हैं, उसी से आप अंदर आते हैं। इसलिए यह पता बदलने से साइन इन का तरीका बदल जाता है। यूनिवर्सिटी का मेलबॉक्स बंद होने से पहले पता बदल लें। | |
| `account.changeEmail` | Change email | ईमेल बदलें | |
| `account.newEmailLabel` | The address you want to sign in with | वह पता जिससे आप साइन इन करना चाहते हैं | |
| `account.newEmailNote` | We will send a code there to check you can read it. Nothing changes until you enter it, and we will tell {current} that this was asked for. | यह जाँचने के लिए कि आप उसे पढ़ सकते हैं, हम वहाँ एक कोड भेजेंगे। कोड डालने तक कुछ नहीं बदलता, और हम {current} को बताएँगे कि यह अनुरोध किया गया है। | |
| `account.yourCurrentAddress` | your current address | आपके मौजूदा पते | |
| `account.sendCode` | Send the code | कोड भेजें | |
| `account.codeSent` | We sent a six-digit code to {email}. It expires in ten minutes. | हमने {email} पर छह अंकों का कोड भेजा है। यह दस मिनट में समाप्त हो जाएगा। | |
| `account.codeSafety` | If nothing arrives, check that the address is right — for your safety this page does not say whether an address already belongs to another account. | अगर कुछ न आए, तो जाँचें कि पता सही है — आपकी सुरक्षा के लिए यह पेज नहीं बताता कि कोई पता पहले से किसी दूसरे अकाउंट का है या नहीं। | |
| `account.codeLabel` | The code from that inbox | उस इनबॉक्स में आया कोड | |
| `account.changing` | Changing… | बदला जा रहा है… | |
| `account.changeMyAddress` | Change my address | मेरा पता बदलें | |
| `account.passwordTitle` | Password | पासवर्ड | |
| `account.checking` | Checking… | जाँच हो रही है… | |
| `account.hasPassword` | You can sign in with your password or with an emailed code. | आप अपने पासवर्ड से या ईमेल पर आए कोड से साइन इन कर सकते हैं। | |
| `account.noPassword` | This account has no password: the code we email you is how you sign in, and that keeps working. Add a password if you would rather type one. | इस अकाउंट पर कोई पासवर्ड नहीं है: हम जो कोड ईमेल करते हैं, उसी से आप साइन इन करते हैं, और वह चलता रहेगा। अगर आप पासवर्ड टाइप करना पसंद करते हैं तो एक जोड़ लें। | |
| `account.changePassword` | Change password | पासवर्ड बदलें | |
| `account.addPassword` | Add a password | पासवर्ड जोड़ें | |
| `account.forgotten` | Forgotten it? Reset by email | भूल गए? ईमेल से रीसेट करें | |
| `account.currentPassword` | Current password | मौजूदा पासवर्ड | |
| `account.newPassword` | New password — at least 10 characters; a short sentence is ideal | नया पासवर्ड — कम से कम 10 अक्षर; एक छोटा वाक्य सबसे अच्छा है | |
| `account.repeatPassword` | The same again | फिर से वही | |
| `account.otherDevices` | Every other device is signed out when the password changes. | पासवर्ड बदलने पर बाकी सभी डिवाइस से साइन आउट हो जाता है। | |
| `account.savePassword` | Save password | पासवर्ड सेव करें | |
| `account.deleteTitle` | Delete your account | अपना अकाउंट हटाएँ | |
| `account.scheduled` | Scheduled. Your account and everything in it will be erased on {date}. | तय हो गया। आपका अकाउंट और उसमें सब कुछ {date} को मिटा दिया जाएगा। | |
| `account.signedOutEverywhere` | You have been signed out on every device, including this one. That is deliberate: if this request was not yours, whoever made it no longer has a way in. | आपको इस डिवाइस समेत हर डिवाइस से साइन आउट कर दिया गया है। ऐसा जान-बूझकर किया गया है: अगर यह अनुरोध आपका नहीं था, तो जिसने किया उसके पास अब अंदर आने का रास्ता नहीं है। | |
| `account.toUndo` | To undo it, sign in again with your email and choose {keep}. Nothing is deleted until {date}. | इसे पलटने के लिए अपने ईमेल से फिर साइन इन करें और {keep} चुनें। {date} तक कुछ नहीं हटाया जाता। | |
| `account.signInAgain` | Sign in again | फिर से साइन इन करें | |
| `account.willErase` | Your account and everything in it will be erased on {date}. | आपका अकाउंट और उसमें सब कुछ {date} को मिटा दिया जाएगा। | |
| `account.changeMind` | Change your mind any time before then and nothing is lost. | उससे पहले कभी भी इरादा बदल लें, कुछ नहीं खोएगा। | |
| `account.keepMyAccount` | Keep my account | मेरा अकाउंट रखें | |
| `account.deleteWarning` | This deletes your theses, chapters, sources, uploaded PDFs, exports and comments. | इससे आपकी थीसिस, अध्याय, स्रोत, अपलोड की गई PDF, एक्सपोर्ट और टिप्पणियाँ हट जाती हैं। | |
| `account.cannotUndo` | It cannot be undone once it runs. | एक बार चलने के बाद इसे पलटा नहीं जा सकता। | |
| `account.exportFirst` | Export anything you want to keep first — that works on any plan. | जो रखना है, उसे पहले एक्सपोर्ट कर लें — यह हर प्लान पर चलता है। | |
| `account.graceNote` | Nothing happens for {days} days. Until then you can change your mind here. Your payment records are kept, because the law requires it. | {days} दिन तक कुछ नहीं होता। तब तक आप यहाँ इरादा बदल सकते हैं। आपके भुगतान के रिकॉर्ड रखे जाते हैं, क्योंकि क़ानून के अनुसार यह ज़रूरी है। | |
| `account.typeEmail` | Type your email address to confirm | पुष्टि के लिए अपना ईमेल पता टाइप करें | |
| `account.scheduling` | Scheduling… | तय किया जा रहा है… | |
| `account.deleteMyAccount` | Delete my account | मेरा अकाउंट हटाएँ | |
| `account.erasesSummary` | Erases your theses, sources, files and exports. You get {days} days to change your mind. | आपकी थीसिस, स्रोत, फ़ाइलें और एक्सपोर्ट मिटा देता है। इरादा बदलने के लिए आपके पास {days} दिन होते हैं। | |
| `account.deleteAccount` | Delete account | अकाउंट हटाएँ | |
| `account.pwSet` | Your password is set. You can sign in with it or with an emailed code. | आपका पासवर्ड बन गया है। आप इससे या ईमेल पर आए कोड से साइन इन कर सकते हैं। | |
| `account.pwChanged` | Your password is changed, and every other device has been signed out. | आपका पासवर्ड बदल गया है, और बाकी सभी डिवाइस से साइन आउट कर दिया गया है। | |
| `account.pwSaveError` | Could not save the password. Try again. | पासवर्ड सेव नहीं हो सका। फिर से कोशिश करें। | |
| `account.cancelDone` | Cancelled. You keep everything until {date}, and nothing is deleted after that. | रद्द हो गया। {date} तक सब कुछ आपके पास रहेगा, और उसके बाद भी कुछ हटाया नहीं जाएगा। | |
| `account.cancelError` | Could not cancel. | रद्द नहीं हो सका। | |
| `account.scheduleError` | Could not schedule the deletion. | हटाने का समय तय नहीं हो सका। | |
| `account.staying` | Your account is staying. Nothing was deleted. | आपका अकाउंट बना रहेगा। कुछ भी हटाया नहीं गया। | |
| `account.sendCodeError` | Could not send the code. | कोड नहीं भेजा जा सका। | |
| `account.nowSignIn` | You now sign in with {email}. | अब आप {email} से साइन इन करते हैं। | |
| `account.changeEmailError` | Could not change the address. | पता नहीं बदला जा सका। | |

## The free-trial notice

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `trial.ended` | Your free trial ended on {date}. | आपका मुफ़्त ट्रायल {date} को समाप्त हो गया। | |
| `trial.endedBody` | Your theses are safe and you can keep writing, editing and exporting. Subscribe to use the AI features again. | आपकी थीसिस सुरक्षित हैं और आप लिखना, बदलना और एक्सपोर्ट करना जारी रख सकते हैं। AI सुविधाएँ फिर से इस्तेमाल करने के लिए सब्सक्राइब करें। | |
| `trial.endsToday` | Your 14-day free trial ends today. | आपका 14 दिन का मुफ़्त ट्रायल आज समाप्त हो रहा है। | |
| `trial.daysOf14` | Free trial: {n} of 14 days left. | मुफ़्त ट्रायल: 14 में से {n} दिन बाकी। | |
| `trial.days` | Free trial: {n} days left. | मुफ़्त ट्रायल: {n} दिन बाकी। | |
| `trial.endsOn` | It ends on {date}. After that your theses stay and you can keep writing; the AI features need a plan. | यह {date} को समाप्त होगा। उसके बाद आपकी थीसिस बनी रहेंगी और आप लिखते रह सकते हैं; AI सुविधाओं के लिए प्लान चाहिए। | |
| `trial.seePlans` | See plans | प्लान देखें | |

## Sign in

| Key | English | हिन्दी | Correction |
|---|---|---|---|
| `signin.photoAlt` | A student reading a printed paper at a table | एक विद्यार्थी मेज़ पर छपा हुआ पेपर पढ़ रहा है | |
| `signin.cardTitle` | Your thesis is where you left it | आपकी थीसिस वहीं है जहाँ आपने छोड़ी थी | |
| `signin.cardBody` | Your library, your outline and your guide's comments stay put between sessions, on any device. | आपकी लाइब्रेरी, रूपरेखा और गाइड की टिप्पणियाँ हर सत्र के बीच, किसी भी डिवाइस पर, वैसी ही रहती हैं। | |
| `signin.point1` | Cites only your library | सिर्फ़ आपकी लाइब्रेरी से साइट करता है | |
| `signin.point2` | Every AI line on record | AI की हर पंक्ति का रिकॉर्ड | |
| `signin.heading` | Sign in or create an account | साइन इन करें या अकाउंट बनाएँ | |
| `signin.checkEmail` | Check your email | अपना ईमेल देखें | |
| `signin.codeHint` | The code works for ten minutes. It may take a moment to arrive. | कोड दस मिनट तक चलता है। आने में थोड़ा समय लग सकता है। | |
| `signin.passwordHint` | Sign in with the password you set under Account. No password yet? Email yourself a code instead, or use “Forgot your password?” to make one. | अकाउंट में बनाए पासवर्ड से साइन इन करें। अभी पासवर्ड नहीं है? इसके बजाय ईमेल पर कोड मँगाएँ, या पासवर्ड बनाने के लिए “पासवर्ड भूल गए?” इस्तेमाल करें। | |
| `signin.emailHint` | We email you a six-digit code that works for ten minutes — and if this address is new, that first code creates your account. No password needed; add one later if you prefer. | हम आपको छह अंकों का कोड ईमेल करते हैं जो दस मिनट तक चलता है — और अगर यह पता नया है, तो वही पहला कोड आपका अकाउंट बना देता है। पासवर्ड की ज़रूरत नहीं; चाहें तो बाद में जोड़ लें। | |
| `signin.emailLabel` | University or personal email | यूनिवर्सिटी या निजी ईमेल | |
| `signin.password` | Password | पासवर्ड | |
| `signin.forgot` | Forgot your password? | पासवर्ड भूल गए? | |
| `signin.signingIn` | Signing in… | साइन इन हो रहा है… | |
| `signin.signIn` | Sign in | साइन इन करें | |
| `signin.codeInstead` | Email me a code instead | इसके बजाय मुझे कोड ईमेल करें | |
| `signin.sendError` | Could not send the code. Check the address and try again. | कोड नहीं भेजा जा सका। पता जाँचें और फिर कोशिश करें। | |
| `signin.codeError` | That code did not work. Ask for a new one. | वह कोड काम नहीं किया। नया कोड मँगाएँ। | |
| `signin.emailMeCode` | Email me a code | मुझे कोड ईमेल करें | |
| `signin.passwordInstead` | Use a password instead | इसके बजाय पासवर्ड इस्तेमाल करें | |
| `signin.sentTo` | Sent to {email} | {email} पर भेजा गया | |
| `signin.codeLabel` | Six-digit code | छह अंकों का कोड | |
| `signin.checking` | Checking… | जाँच हो रही है… | |
| `signin.differentEmail` | Use a different email | कोई दूसरा ईमेल इस्तेमाल करें | |
| `signin.or` | or | या | |
| `signin.openingGoogle` | Opening Google… | Google खुल रहा है… | |
| `signin.google` | Continue with Google | Google से जारी रखें | |
| `signin.newHere` | New here? | पहली बार आए हैं? | |
| `signin.createAccount` | Create an account | अकाउंट बनाएँ | |
| `signin.newPassword` |  — with an emailed code or a password of your choosing. |  — ईमेल पर आए कोड से या अपने चुने पासवर्ड से। | |
| `signin.newCode` |  — or just enter your address above; the first code creates it. |  — या बस ऊपर अपना पता डालें; पहला कोड ही अकाउंट बना देता है। | |
| `signin.accept` | By continuing you accept our {terms} and how we handle your text — {privacy}. We never train on your thesis. | आगे बढ़कर आप हमारी {terms} और आपके टेक्स्ट के साथ हमारे व्यवहार को स्वीकार करते हैं — {privacy}। हम आपकी थीसिस पर कभी AI को प्रशिक्षित नहीं करते। | |
| `signin.terms` | terms | शर्तें | |
| `signin.readFirst` | read that first | पहले इसे पढ़ें | |
| `signin.language` | Language | भाषा | |

## Left in English on purpose

- `editor.usage` — Assist {assist} · Draft {draft}
- `editor.suggest` — Suggest
