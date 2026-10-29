/*
 * node docs/listing/update-2.3.js [--dry]
 *
 * Brings the 51 translated store listings up to 2.3, the way docs/store-description.txt was in English:
 *   - the "New: mute a channel…" line on top
 *   - a MUTE A CHANNEL, EVERYWHERE section after the opening paragraph
 *   - the search bar's last point without the mute (it has its own section now)
 *   - "How long any playlist is, and how much of it you have left" first under ANY PLAYLIST
 * and rewrites each language's store summary (_locales/<lang>/messages.json, extDesc) to the English shape:
 * what it is, what it filters, mute. A summary over 132 characters stops the run.
 *
 * Every listing is ten paragraphs: the opening, six sections, then three closing lines. A file that is not, or that
 * already starts with its new line, is left alone and said so.
 */
const fs = require("fs");
const path = require("path");

const DIR = __dirname, LOCALES = path.join(__dirname, "..", "..", "_locales");
const DRY = process.argv.includes("--dry");

// [new line, heading, five mute points, search-bar point, playlist-length point, summary]
const T = {
  am: ["አዲስ፦ ከYouTube የራሱ ⋮ ምናሌ ቻናልን ድምጸ-ከል ያድርጉ፤ ከፍለጋ፣ ከመነሻ ገጽ፣ ከደንበኝነት ምዝገባዎች እና ከShorts ይጠፋል። የYouTube የራሱ ቻናልን ያለመምከር አማራጭ ፍለጋን ፈጽሞ አይነካም። ይሄ ግን ይነካል።",
    "ቻናልን በሁሉም ቦታ ድምጸ-ከል ያድርጉ", "በእያንዳንዱ ቪዲዮ ⋮ ምናሌ ውስጥ «Mute channel everywhere»", "ከፍለጋ፣ ከመነሻ ገጽ፣ ከደንበኝነት ምዝገባዎች እና ከሚመለከቱት ቪዲዮ አጠገብ ካሉት ቪዲዮዎች ይጠፋል",
    "Shortsቹም ይጠፋሉ፣ ከመነሻ ገጽም ከፍለጋም", "ቃላትን ድምጸ-ከል ያድርጉ፦ ርዕሱ ውስጥ ከነሱ አንዱ ያለበት ማንኛውም ቪዲዮ ይጠፋል", "ወዲያውኑ ይቀልብሱ፣ በፈለጉት ጊዜ ድምጸ-ከሉን ያንሱ፣ እና ዝርዝርዎን ከሌላ ማገጃ ያምጡ",
    "ፍለጋን ይከተሉ፣ እና ያዩትን በእያንዳንዱ ድንክዬ ላይ ይመልከቱ", "የማንኛውም አጫዋች ዝርዝር ርዝመት፣ እና ምን ያህል እንደቀረዎት",
    "ያዩትን የሚያውቅ የYouTube ፍለጋ። ቻናሎችን፣ አጫዋች ዝርዝሮችን፣ ታሪክን እና በኋላ ይመልከቱን ያጣሩ። ቻናልን በሁሉም ቦታ ድምጸ-ከል ያድርጉ።"],
  ar: ["جديد: اكتم أي قناة من قائمة ⋮ في YouTube نفسها، فتختفي من البحث والصفحة الرئيسية والاشتراكات وShorts. خيار YouTube لإيقاف اقتراح القناة لا يمسّ البحث أبدًا. أما هذا فيفعل.",
    "اكتم أي قناة، في كل مكان", "\"Mute channel everywhere\" في قائمة ⋮ لكل فيديو", "تختفي من البحث والصفحة الرئيسية والاشتراكات والفيديوهات المجاورة لما تشاهده",
    "ومقاطع Shorts الخاصة بها تختفي أيضًا، في الصفحة الرئيسية وفي البحث", "اكتم كلمات: أي فيديو في عنوانه إحداها يختفي", "تراجع فورًا، وألغِ الكتم متى شئت، وانقل قائمتك من أداة حظر أخرى",
    "تابع بحثًا، وشاهد ما شاهدته على كل صورة مصغّرة", "مدة أي قائمة تشغيل، وكم تبقّى لك منها",
    "بحث YouTube الذي يعرف ما شاهدته. صفِّ القنوات وقوائم التشغيل والسجل والمشاهدة لاحقًا. واكتم أي قناة في كل مكان."],
  bg: ["Ново: заглушете канал от собственото меню ⋮ на YouTube и той изчезва от търсенето, началната страница, абонаментите и Shorts. Опцията на YouTube да не препоръчва канал никога не засяга търсенето. Това го прави.",
    "ЗАГЛУШЕТЕ КАНАЛ, НАВСЯКЪДЕ", "„Mute channel everywhere“ в менюто ⋮ на всеки видеоклип", "Изчезва от търсенето, началната страница, абонаментите и видеоклиповете до този, който гледате",
    "Изчезват и неговите Shorts, на началната страница и в търсенето", "Заглушаване на думи: всеки видеоклип с такава дума в заглавието изчезва", "Отменете веднага, премахнете заглушаването по всяко време и пренесете списъка си от друг блокер",
    "Следете търсене и вижте какво сте гледали на всяка миниатюра", "Колко е дълъг всеки плейлист и колко ви остава от него",
    "Търсенето в YouTube, което знае какво сте гледали. Филтрирайте канали, плейлисти, история и „По-късно“. Заглушете канал навсякъде."],
  bn: ["নতুন: YouTube-এর নিজের ⋮ মেনু থেকে কোনো চ্যানেল মিউট করুন, সেটি সার্চ, হোম, সাবস্ক্রিপশন আর Shorts থেকে উধাও হয়ে যাবে। YouTube-এর চ্যানেল সাজেস্ট না করার অপশন সার্চে কখনো কাজ করে না। এটা করে।",
    "চ্যানেল মিউট করুন, সব জায়গায়", "প্রতিটি ভিডিওর ⋮ মেনুতে \"Mute channel everywhere\"", "সার্চ, হোম, সাবস্ক্রিপশন আর আপনি যে ভিডিও দেখছেন তার পাশের ভিডিও থেকে উধাও",
    "এর Shorts-ও চলে যায়, হোমে আর সার্চে", "শব্দ মিউট করুন: শিরোনামে সেই শব্দ থাকলে যেকোনো ভিডিও উধাও", "সঙ্গে সঙ্গে আনডু করুন, যখন খুশি আনমিউট করুন, আর অন্য ব্লকার থেকে তালিকা নিয়ে আসুন",
    "কোনো সার্চ ফলো করুন, আর প্রতিটি থাম্বনেইলে দেখুন কী দেখেছেন", "যেকোনো প্লেলিস্ট কত লম্বা, আর তার কতটা বাকি",
    "যে YouTube সার্চ জানে আপনি কী দেখেছেন। চ্যানেল, প্লেলিস্ট, ইতিহাস ও পরে দেখুন ফিল্টার করুন। চ্যানেল সব জায়গায় মিউট করুন।"],
  ca: ["Novetat: silencia un canal des del menú ⋮ del mateix YouTube i desapareix de la cerca, l'inici, les subscripcions i els Shorts. L'opció de YouTube de no recomanar un canal no toca mai la cerca. Aquesta sí.",
    "SILENCIA UN CANAL, A TOT ARREU", "«Mute channel everywhere» al menú ⋮ de cada vídeo", "Desapareix de la cerca, l'inici, les subscripcions i els vídeos al costat del que estàs mirant",
    "També se'n van els seus Shorts, a l'inici i a la cerca", "Silencia paraules: qualsevol vídeo que en tingui una al títol desapareix", "Desfés-ho a l'instant, deixa de silenciar quan vulguis i porta la teva llista d'un altre bloquejador",
    "Segueix una cerca i mira què has vist a cada miniatura", "Quant dura qualsevol llista de reproducció i quant te'n queda",
    "La cerca de YouTube que sap què ja has vist. Filtra canals, llistes, historial i Mira més tard. Silencia un canal a tot arreu."],
  cs: ["Novinka: ztlumte kanál přímo z nabídky ⋮ na YouTube a zmizí z vyhledávání, domovské stránky, odběrů i Shorts. Volba YouTube nedoporučovat kanál vyhledávání nikdy neovlivní. Tohle ano.",
    "ZTLUMTE KANÁL, VŠUDE", "„Mute channel everywhere“ v nabídce ⋮ u každého videa", "Zmizí z vyhledávání, domovské stránky, odběrů i z videí vedle toho, které sledujete",
    "Zmizí i jeho Shorts, na domovské stránce i ve vyhledávání", "Ztlumení slov: každé video, které má takové slovo v názvu, zmizí", "Okamžitě vraťte zpět, kdykoli zrušte ztlumení a přeneste seznam z jiného blokovače",
    "Sledujte vyhledávání a na každé miniatuře uvidíte, co jste už viděli", "Jak dlouhý je jakýkoli playlist a kolik vám z něj zbývá",
    "Vyhledávání na YouTube, které ví, co jste viděli. Filtrujte kanály, playlisty, historii a Na později. Ztlumte kanál všude."],
  da: ["Nyt: gør en kanal tavs fra YouTubes egen ⋮-menu, og den forsvinder fra søgning, forsiden, abonnementer og Shorts. YouTubes valg om ikke at anbefale en kanal rører aldrig søgningen. Det gør det her.",
    "GØR EN KANAL TAVS, OVERALT", "\"Mute channel everywhere\" i ⋮-menuen på hver video", "Væk fra søgning, forsiden, abonnementer og videoerne ved siden af den, du ser",
    "Dens Shorts forsvinder også, på forsiden og i søgningen", "Gør ord tavse: enhver video med et af dem i titlen forsvinder", "Fortryd med det samme, slå tavsheden fra når som helst, og hent en liste fra en anden blocker",
    "Følg en søgning, og se hvad du har set, på hvert miniaturebillede", "Hvor lang en playliste er, og hvor meget du mangler",
    "YouTube-søgningen, der ved, hvad du har set. Filtrer kanaler, playlister, historik og Se senere. Gør en kanal tavs overalt."],
  de: ["Neu: Schalte einen Kanal direkt im ⋮-Menü von YouTube stumm, und er verschwindet aus der Suche, der Startseite, den Abos und Shorts. YouTubes Option, einen Kanal nicht mehr zu empfehlen, wirkt nie auf die Suche. Das hier schon.",
    "EINEN KANAL STUMMSCHALTEN, ÜBERALL", "„Mute channel everywhere“ im ⋮-Menü jedes Videos", "Weg aus der Suche, der Startseite, den Abos und den Videos neben dem, das du gerade schaust",
    "Seine Shorts verschwinden auch, auf der Startseite und in der Suche", "Wörter stummschalten: Jedes Video mit einem davon im Titel verschwindet", "Sofort rückgängig machen, jederzeit wieder einblenden und eine Liste aus einem anderen Blocker übernehmen",
    "Folge einer Suche und sieh auf jedem Thumbnail, was du schon gesehen hast", "Wie lang jede Playlist ist und wie viel du noch vor dir hast",
    "Die YouTube-Suche, die weiß, was du gesehen hast. Filtere Kanäle, Playlists, Verlauf und Später ansehen. Kanäle überall stumm."],
  el: ["Νέο: βάλτε ένα κανάλι σε σίγαση από το ίδιο το μενού ⋮ του YouTube και εξαφανίζεται από την αναζήτηση, την αρχική, τις συνδρομές και τα Shorts. Η επιλογή του YouTube να μην προτείνει ένα κανάλι δεν αγγίζει ποτέ την αναζήτηση. Αυτό το κάνει.",
    "ΣΙΓΑΣΗ ΚΑΝΑΛΙΟΥ, ΠΑΝΤΟΥ", "«Mute channel everywhere» στο μενού ⋮ κάθε βίντεο", "Φεύγει από την αναζήτηση, την αρχική, τις συνδρομές και τα βίντεο δίπλα σε αυτό που βλέπετε",
    "Φεύγουν και τα Shorts του, από την αρχική και την αναζήτηση", "Σίγαση λέξεων: κάθε βίντεο με μία από αυτές στον τίτλο εξαφανίζεται", "Αναίρεση αμέσως, άρση σίγασης όποτε θέλετε, και μεταφορά λίστας από άλλο πρόγραμμα αποκλεισμού",
    "Ακολουθήστε μια αναζήτηση και δείτε τι έχετε δει σε κάθε μικρογραφία", "Πόσο διαρκεί κάθε playlist και πόσο σας απομένει",
    "Η αναζήτηση YouTube που ξέρει τι έχετε δει. Φιλτράρετε κανάλια, playlist, ιστορικό και «Αργότερα». Σίγαση καναλιών παντού."],
  es: ["Novedad: silencia un canal desde el propio menú ⋮ de YouTube y desaparece de la búsqueda, el inicio, las suscripciones y los Shorts. La opción de YouTube de no recomendar un canal nunca afecta a la búsqueda. Esta sí.",
    "SILENCIA UN CANAL, EN TODAS PARTES", "«Mute channel everywhere» en el menú ⋮ de cada vídeo", "Desaparece de la búsqueda, el inicio, las suscripciones y los vídeos junto al que estás viendo",
    "Sus Shorts también se van, en el inicio y en la búsqueda", "Silencia palabras: cualquier vídeo con una de ellas en el título desaparece", "Deshaz al instante, deja de silenciar cuando quieras y trae tu lista desde otro bloqueador",
    "Sigue una búsqueda y mira lo que ya has visto en cada miniatura", "Cuánto dura cualquier lista de reproducción y cuánto te queda",
    "La búsqueda de YouTube que sabe lo que has visto. Filtra canales, listas, historial y Ver más tarde. Silencia cualquier canal."],
  es_419: ["Novedad: silencia un canal desde el propio menú ⋮ de YouTube y desaparece de la búsqueda, la página principal, las suscripciones y los Shorts. La opción de YouTube de no recomendar un canal nunca afecta la búsqueda. Esta sí.",
    "SILENCIA UN CANAL, EN TODAS PARTES", "\"Mute channel everywhere\" en el menú ⋮ de cada video", "Desaparece de la búsqueda, la página principal, las suscripciones y los videos junto al que estás viendo",
    "Sus Shorts también se van, en la página principal y en la búsqueda", "Silencia palabras: cualquier video con una de ellas en el título desaparece", "Deshaz al instante, deja de silenciar cuando quieras y trae tu lista desde otro bloqueador",
    "Sigue una búsqueda y mira lo que ya viste en cada miniatura", "Cuánto dura cualquier lista de reproducción y cuánto te queda",
    "La búsqueda de YouTube que sabe lo que viste. Filtra canales, listas, historial y Ver más tarde. Silencia canales en todas partes."],
  et: ["Uus: vaigista kanal otse YouTube'i enda ⋮ menüüst ja see kaob otsingust, avalehelt, tellimustest ja Shortsist. YouTube'i valik kanalit mitte soovitada ei puuduta kunagi otsingut. See siin puudutab.",
    "VAIGISTA KANAL, KÕIKJAL", "„Mute channel everywhere“ iga video ⋮ menüüs", "Kaob otsingust, avalehelt, tellimustest ja videote kõrvalt, mida parasjagu vaatad",
    "Ka selle Shortsid kaovad, avalehel ja otsingus", "Vaigista sõnu: iga video, mille pealkirjas on mõni neist, kaob", "Võta kohe tagasi, lõpeta vaigistus millal tahes ja too nimekiri üle mõnest teisest blokeerijast",
    "Jälgi otsingut ja näe igal pisipildil, mida oled juba vaadanud", "Kui pikk on mis tahes esitusloend ja kui palju sul sellest veel jäänud on",
    "YouTube'i otsing, mis teab, mida sa vaatasid. Filtreeri kanaleid, esitusloendeid, ajalugu ja Vaata hiljem. Vaigista kanal kõikjal."],
  fa: ["جدید: یک کانال را از همان منوی ⋮ خود YouTube بی‌صدا کنید تا از جستجو، صفحه اصلی، اشتراک‌ها و Shorts حذف شود. گزینه خود YouTube برای پیشنهاد ندادن کانال هیچ‌وقت روی جستجو اثر نمی‌گذارد. این یکی می‌گذارد.",
    "بی‌صدا کردن کانال، همه‌جا", "«Mute channel everywhere» در منوی ⋮ هر ویدیو", "از جستجو، صفحه اصلی، اشتراک‌ها و ویدیوهای کنار ویدیویی که تماشا می‌کنید حذف می‌شود",
    "Shortsهایش هم می‌روند، در صفحه اصلی و جستجو", "بی‌صدا کردن کلمه‌ها: هر ویدیویی که یکی از آن‌ها در عنوانش باشد حذف می‌شود", "فوراً برگردانید، هر وقت خواستید از بی‌صدا درآورید، و فهرستتان را از مسدودکننده دیگری بیاورید",
    "یک جستجو را دنبال کنید و روی هر تصویر کوچک ببینید چه چیزی را دیده‌اید", "مدت هر فهرست پخش، و اینکه چقدر از آن مانده است",
    "جستجوی YouTube که می‌داند چه دیده‌اید. کانال‌ها، فهرست‌های پخش، تاریخچه و «بعداً تماشا» را فیلتر کنید. کانال‌ها را بی‌صدا کنید."],
  fi: ["Uutta: mykistä kanava suoraan YouTuben omasta ⋮-valikosta, niin se katoaa hausta, etusivulta, tilauksista ja Shortsista. YouTuben valinta jättää kanava suosittelematta ei koske koskaan hakua. Tämä koskee.",
    "MYKISTÄ KANAVA, KAIKKIALLA", "”Mute channel everywhere” jokaisen videon ⋮-valikossa", "Poissa hausta, etusivulta, tilauksista ja katsomasi videon vierestä",
    "Myös sen Shortsit katoavat, etusivulta ja hausta", "Mykistä sanoja: jokainen video, jonka otsikossa on jokin niistä, katoaa", "Kumoa heti, poista mykistys milloin vain ja tuo lista toisesta estotyökalusta",
    "Seuraa hakua ja näe jokaisesta pikkukuvasta, mitä olet jo katsonut", "Kuinka pitkä mikä tahansa soittolista on ja paljonko siitä on jäljellä",
    "YouTube-haku, joka tietää, mitä olet katsonut. Suodata kanavia, soittolistoja, historiaa ja Katso myöhemmin. Mykistä kanavia."],
  fil: ["Bago: i-mute ang isang channel mula mismo sa ⋮ menu ng YouTube, at mawawala ito sa search, Home, Subscriptions at Shorts. Ang opsyon ng YouTube na huwag irekomenda ang channel ay hindi kailanman umaabot sa search. Ito, oo.",
    "I-MUTE ANG CHANNEL, KAHIT SAAN", "\"Mute channel everywhere\" sa ⋮ menu ng bawat video", "Wala na sa search, Home, Subscriptions at sa mga video katabi ng pinapanood mo",
    "Mawawala rin ang Shorts nito, sa Home at sa search", "I-mute ang mga salita: mawawala ang anumang video na may isa sa mga ito sa pamagat", "I-undo agad, i-unmute anumang oras, at ilipat ang listahan mo mula sa ibang blocker",
    "I-follow ang isang search, at makita sa bawat thumbnail kung ano na ang napanood mo", "Gaano kahaba ang anumang playlist, at gaano pa ang natitira sa iyo",
    "Ang YouTube search na alam ang napanood mo. I-filter ang channel, playlist, history at Panoorin Mamaya. I-mute ang anumang channel."],
  fr: ["Nouveau : mettez une chaîne en sourdine depuis le menu ⋮ de YouTube lui-même, et elle disparaît de la recherche, de l'accueil, des abonnements et des Shorts. L'option de YouTube pour ne plus recommander une chaîne ne touche jamais la recherche. Celle-ci, si.",
    "METTRE UNE CHAÎNE EN SOURDINE, PARTOUT", "« Mute channel everywhere » dans le menu ⋮ de chaque vidéo", "Disparaît de la recherche, de l'accueil, des abonnements et des vidéos à côté de celle que vous regardez",
    "Ses Shorts disparaissent aussi, sur l'accueil et dans la recherche", "Mots en sourdine : toute vidéo qui en contient un dans son titre disparaît", "Annulez tout de suite, rétablissez quand vous voulez, et importez votre liste depuis un autre bloqueur",
    "Suivez une recherche et voyez ce que vous avez déjà vu sur chaque miniature", "La durée de n'importe quelle playlist, et ce qu'il vous en reste",
    "La recherche YouTube qui sait ce que vous avez vu. Filtrez chaînes, playlists, historique et À regarder plus tard. Sourdine partout."],
  gu: ["નવું: YouTubeના પોતાના ⋮ મેનૂમાંથી ચેનલ મ્યૂટ કરો, અને તે શોધ, હોમ, સબ્સ્ક્રિપ્શન્સ અને Shortsમાંથી ગાયબ થઈ જશે. YouTubeનો ચેનલ ભલામણ ન કરવાનો વિકલ્પ શોધને ક્યારેય સ્પર્શતો નથી. આ સ્પર્શે છે.",
    "ચેનલ મ્યૂટ કરો, બધે", "દરેક વીડિયોના ⋮ મેનૂમાં \"Mute channel everywhere\"", "શોધ, હોમ, સબ્સ્ક્રિપ્શન્સ અને તમે જે વીડિયો જુઓ છો તેની બાજુના વીડિયોમાંથી ગાયબ",
    "તેના Shorts પણ જાય છે, હોમ પર અને શોધમાં", "શબ્દો મ્યૂટ કરો: શીર્ષકમાં તેમાંથી કોઈ શબ્દ હોય એવો દરેક વીડિયો ગાયબ", "તરત પાછું વાળો, ગમે ત્યારે અનમ્યૂટ કરો, અને બીજા બ્લોકરમાંથી તમારી યાદી લાવો",
    "કોઈ શોધને ફોલો કરો, અને દરેક થંબનેલ પર જુઓ કે તમે શું જોયું છે", "કોઈપણ પ્લેલિસ્ટ કેટલી લાંબી છે, અને તેમાંથી કેટલું બાકી છે",
    "તમે શું જોયું છે તે જાણતી YouTube શોધ. ચેનલ, પ્લેલિસ્ટ, ઇતિહાસ અને પછીથી જુઓ ફિલ્ટર કરો. ચેનલને બધે મ્યૂટ કરો."],
  he: ["חדש: השתיקו ערוץ ישירות מתפריט ⋮ של YouTube עצמו, והוא נעלם מהחיפוש, מדף הבית, מהמינויים ומ-Shorts. האפשרות של YouTube לא להמליץ על ערוץ אף פעם לא נוגעת בחיפוש. זה כן.",
    "השתקת ערוץ, בכל מקום", "\"Mute channel everywhere\" בתפריט ⋮ של כל סרטון", "נעלם מהחיפוש, מדף הבית, מהמינויים ומהסרטונים שליד הסרטון שאתם צופים בו",
    "גם ה-Shorts שלו נעלמים, בדף הבית ובחיפוש", "השתקת מילים: כל סרטון שיש בכותרת שלו אחת מהן נעלם", "ביטול מיידי, ביטול השתקה בכל עת, והעברת רשימה מחוסם אחר",
    "עקבו אחרי חיפוש, וראו על כל תמונה ממוזערת מה כבר ראיתם", "כמה ארוך כל פלייליסט, וכמה נשאר לכם ממנו",
    "חיפוש YouTube שיודע מה ראיתם. סננו ערוצים, פלייליסטים, היסטוריה ו'לצפייה בהמשך'. השתיקו ערוץ בכל מקום."],
  hi: ["नया: YouTube के अपने ⋮ मेन्यू से किसी चैनल को म्यूट करें, और वह खोज, होम, सदस्यताओं और Shorts से गायब हो जाएगा। YouTube का चैनल का सुझाव न देने वाला विकल्प खोज पर कभी असर नहीं डालता। यह डालता है।",
    "चैनल म्यूट करें, हर जगह", "हर वीडियो के ⋮ मेन्यू में \"Mute channel everywhere\"", "खोज, होम, सदस्यताओं और आप जो वीडियो देख रहे हैं उसके पास के वीडियो से गायब",
    "उसके Shorts भी चले जाते हैं, होम पर और खोज में", "शब्द म्यूट करें: जिस वीडियो के शीर्षक में उनमें से कोई शब्द हो, वह गायब", "तुरंत पहले जैसा करें, कभी भी अनम्यूट करें, और किसी दूसरे ब्लॉकर से अपनी सूची ले आएं",
    "किसी खोज को फ़ॉलो करें, और हर थंबनेल पर देखें कि आपने क्या देखा है", "किसी भी प्लेलिस्ट की कुल लंबाई, और उसमें से कितना बाकी है",
    "YouTube की वह खोज जो जानती है कि आपने क्या देखा। चैनल, प्लेलिस्ट, इतिहास और बाद में देखें फ़िल्टर करें। चैनल हर जगह म्यूट करें।"],
  hr: ["Novo: utišajte kanal iz samog YouTubeova izbornika ⋮ i nestaje iz pretraživanja, početne stranice, pretplata i Shorts videozapisa. YouTubeova opcija da ne preporučuje kanal nikad ne utječe na pretraživanje. Ova utječe.",
    "UTIŠAJTE KANAL, POSVUDA", "„Mute channel everywhere” u izborniku ⋮ svakog videozapisa", "Nestaje iz pretraživanja, s početne stranice, iz pretplata i iz videozapisa pored onog koji gledate",
    "Nestaju i njegovi Shorts, na početnoj stranici i u pretraživanju", "Utišajte riječi: svaki videozapis s jednom od njih u naslovu nestaje", "Odmah poništite, ukinite utišavanje kad god želite i prenesite popis iz drugog blokatora",
    "Pratite pretraživanje i na svakoj minijaturi vidite što ste već gledali", "Koliko traje bilo koji popis za reprodukciju i koliko vam je od njega ostalo",
    "YouTube pretraživanje koje zna što ste gledali. Filtrirajte kanale, popise, povijest i Gledaj kasnije. Utišajte kanal posvuda."],
  hu: ["Újdonság: némíts el egy csatornát a YouTube saját ⋮ menüjéből, és eltűnik a keresésből, a kezdőlapról, a feliratkozásokból és a Shorts-ból. A YouTube lehetősége, hogy ne ajánljon egy csatornát, a keresést soha nem érinti. Ez igen.",
    "NÉMÍTS EL EGY CSATORNÁT, MINDENHOL", "„Mute channel everywhere” minden videó ⋮ menüjében", "Eltűnik a keresésből, a kezdőlapról, a feliratkozásokból és a nézett videó melletti videók közül",
    "A Shorts-jai is eltűnnek, a kezdőlapról és a keresésből", "Szavak némítása: minden videó eltűnik, amelynek címében szerepel valamelyikük", "Azonnal visszavonhatod, bármikor feloldhatod, és átviheted a listádat egy másik blokkolóból",
    "Kövess egy keresést, és minden bélyegképen lásd, mit néztél már meg", "Bármely lejátszási lista hossza, és hogy mennyi van még hátra belőle",
    "YouTube-keresés, amely tudja, mit néztél. Szűrj csatornákat, listákat, előzményeket és a Megnézendőt. Némíts el csatornákat."],
  id: ["Baru: bisukan channel langsung dari menu ⋮ milik YouTube, dan channel itu hilang dari pencarian, Beranda, Langganan, dan Shorts. Opsi YouTube untuk tidak merekomendasikan channel tidak pernah menyentuh pencarian. Yang ini menyentuh.",
    "BISUKAN CHANNEL, DI MANA SAJA", "\"Mute channel everywhere\" di menu ⋮ setiap video", "Hilang dari pencarian, Beranda, Langganan, dan video di samping yang sedang kamu tonton",
    "Shorts-nya juga hilang, di Beranda dan di pencarian", "Bisukan kata: video apa pun yang judulnya memuat salah satunya akan hilang", "Urungkan seketika, batalkan bisu kapan saja, dan bawa daftarmu dari pemblokir lain",
    "Ikuti pencarian, dan lihat apa yang sudah kamu tonton di setiap thumbnail", "Berapa lama playlist apa pun, dan berapa yang tersisa untukmu",
    "Pencarian YouTube yang tahu apa yang sudah kamu tonton. Filter channel, playlist, riwayat, dan Tonton Nanti. Bisukan channel."],
  it: ["Novità: silenzia un canale dal menu ⋮ di YouTube stesso, e sparisce da ricerca, Home, iscrizioni e Shorts. L'opzione di YouTube per non consigliare un canale non tocca mai la ricerca. Questa sì.",
    "SILENZIA UN CANALE, OVUNQUE", "«Mute channel everywhere» nel menu ⋮ di ogni video", "Sparisce da ricerca, Home, iscrizioni e dai video accanto a quello che stai guardando",
    "Spariscono anche i suoi Shorts, nella Home e nella ricerca", "Silenzia parole: ogni video con una di esse nel titolo sparisce", "Annulla subito, togli il silenzio quando vuoi e porta la tua lista da un altro blocco",
    "Segui una ricerca e vedi su ogni miniatura cosa hai già guardato", "Quanto dura qualsiasi playlist, e quanto ti resta",
    "La ricerca di YouTube che sa cosa hai visto. Filtra canali, playlist, cronologia e Guarda più tardi. Silenzia un canale ovunque."],
  ja: ["新機能：YouTube自身の⋮メニューからチャンネルをミュートすると、検索、ホーム、登録チャンネル、Shortsから消えます。YouTubeの「チャンネルをおすすめに表示しない」は検索には一切効きません。これは効きます。",
    "チャンネルを、どこでもミュート", "すべての動画の⋮メニューに「Mute channel everywhere」", "検索、ホーム、登録チャンネル、視聴中の動画の横の動画から消えます",
    "そのチャンネルのShortsも、ホームと検索から消えます", "ワードのミュート：タイトルにその言葉を含む動画が消えます", "すぐに元に戻せて、いつでもミュート解除でき、他のブロッカーからリストを移せます",
    "検索をフォローし、すべてのサムネイルで視聴済みかどうかを確認", "どの再生リストも合計の長さと、残りの時間がわかります",
    "見た動画を覚えているYouTube検索。チャンネル、再生リスト、履歴、「後で見る」を絞り込み。チャンネルをどこでもミュート。"],
  kn: ["ಹೊಸದು: YouTube ನದೇ ⋮ ಮೆನುವಿನಿಂದ ಚಾನಲ್ ಅನ್ನು ಮ್ಯೂಟ್ ಮಾಡಿ, ಅದು ಹುಡುಕಾಟ, ಹೋಮ್, ಚಂದಾದಾರಿಕೆಗಳು ಮತ್ತು Shorts ನಿಂದ ಮಾಯವಾಗುತ್ತದೆ. ಚಾನಲ್ ಶಿಫಾರಸು ಮಾಡದಿರುವ YouTube ನ ಆಯ್ಕೆ ಹುಡುಕಾಟವನ್ನು ಎಂದಿಗೂ ಮುಟ್ಟುವುದಿಲ್ಲ. ಇದು ಮುಟ್ಟುತ್ತದೆ.",
    "ಚಾನಲ್ ಮ್ಯೂಟ್ ಮಾಡಿ, ಎಲ್ಲೆಡೆ", "ಪ್ರತಿ ವೀಡಿಯೊದ ⋮ ಮೆನುವಿನಲ್ಲಿ \"Mute channel everywhere\"", "ಹುಡುಕಾಟ, ಹೋಮ್, ಚಂದಾದಾರಿಕೆಗಳು ಮತ್ತು ನೀವು ನೋಡುತ್ತಿರುವ ವೀಡಿಯೊದ ಪಕ್ಕದ ವೀಡಿಯೊಗಳಿಂದ ಮಾಯ",
    "ಅದರ Shorts ಕೂಡ ಹೋಗುತ್ತವೆ, ಹೋಮ್‌ನಲ್ಲಿ ಮತ್ತು ಹುಡುಕಾಟದಲ್ಲಿ", "ಪದಗಳನ್ನು ಮ್ಯೂಟ್ ಮಾಡಿ: ಶೀರ್ಷಿಕೆಯಲ್ಲಿ ಅವುಗಳಲ್ಲಿ ಒಂದು ಇರುವ ಯಾವುದೇ ವೀಡಿಯೊ ಮಾಯ", "ತಕ್ಷಣ ರದ್ದುಗೊಳಿಸಿ, ಯಾವಾಗ ಬೇಕಾದರೂ ಅನ್‌ಮ್ಯೂಟ್ ಮಾಡಿ, ಮತ್ತು ಬೇರೆ ಬ್ಲಾಕರ್‌ನಿಂದ ಪಟ್ಟಿಯನ್ನು ತನ್ನಿ",
    "ಹುಡುಕಾಟವನ್ನು ಫಾಲೋ ಮಾಡಿ, ಪ್ರತಿ ಥಂಬ್‌ನೇಲ್‌ನಲ್ಲಿ ನೀವು ಏನು ನೋಡಿದ್ದೀರಿ ಎಂದು ನೋಡಿ", "ಯಾವುದೇ ಪ್ಲೇಲಿಸ್ಟ್ ಎಷ್ಟು ಉದ್ದ, ಮತ್ತು ಅದರಲ್ಲಿ ಎಷ್ಟು ಉಳಿದಿದೆ",
    "ನೀವು ನೋಡಿದ್ದು ತಿಳಿದಿರುವ YouTube ಹುಡುಕಾಟ. ಚಾನಲ್, ಪ್ಲೇಲಿಸ್ಟ್, ಇತಿಹಾಸ, ನಂತರ ವೀಕ್ಷಿಸಿ ಫಿಲ್ಟರ್ ಮಾಡಿ. ಚಾನಲ್ ಎಲ್ಲೆಡೆ ಮ್ಯೂಟ್ ಮಾಡಿ."],
  ko: ["새 기능: YouTube 자체의 ⋮ 메뉴에서 채널을 음소거하면 검색, 홈, 구독, Shorts에서 사라집니다. YouTube의 '채널 추천 안함'은 검색에는 전혀 적용되지 않습니다. 이건 됩니다.",
    "채널 음소거, 어디서나", "모든 동영상의 ⋮ 메뉴에 \"Mute channel everywhere\"", "검색, 홈, 구독, 그리고 보고 있는 동영상 옆의 동영상에서 사라집니다",
    "그 채널의 Shorts도 홈과 검색에서 사라집니다", "단어 음소거: 제목에 그 단어가 들어간 동영상은 모두 사라집니다", "바로 되돌리고, 언제든 음소거를 해제하고, 다른 차단 도구의 목록을 가져올 수 있습니다",
    "검색을 팔로우하고, 모든 썸네일에서 이미 본 영상을 확인하세요", "어떤 재생목록이든 전체 길이와 남은 시간",
    "내가 본 영상을 기억하는 YouTube 검색. 채널, 재생목록, 시청 기록, 나중에 볼 동영상을 필터링하고, 채널을 어디서나 음소거하세요."],
  lt: ["Nauja: nutildykite kanalą tiesiai iš paties YouTube ⋮ meniu ir jis dingsta iš paieškos, pagrindinio puslapio, prenumeratų ir Shorts. YouTube parinktis nerekomenduoti kanalo niekada nepaveikia paieškos. Ši paveikia.",
    "NUTILDYKITE KANALĄ, VISUR", "„Mute channel everywhere“ kiekvieno vaizdo įrašo ⋮ meniu", "Dingsta iš paieškos, pagrindinio puslapio, prenumeratų ir vaizdo įrašų šalia to, kurį žiūrite",
    "Dingsta ir jo Shorts, pagrindiniame puslapyje ir paieškoje", "Nutildykite žodžius: dingsta kiekvienas vaizdo įrašas, kurio pavadinime yra vienas iš jų", "Atšaukite iškart, atšaukite nutildymą bet kada ir perkelkite sąrašą iš kito blokavimo įrankio",
    "Sekite paiešką ir kiekvienoje miniatiūroje matykite, ką jau žiūrėjote", "Kiek trunka bet kuris grojaraštis ir kiek jo jums dar liko",
    "YouTube paieška, kuri žino, ką žiūrėjote. Filtruokite kanalus, grojaraščius, istoriją ir Žiūrėti vėliau. Nutildykite kanalą visur."],
  lv: ["Jaunums: apklusiniet kanālu tieši no paša YouTube ⋮ izvēlnes, un tas pazūd no meklēšanas, sākumlapas, abonementiem un Shorts. YouTube iespēja neieteikt kanālu nekad neietekmē meklēšanu. Šī ietekmē.",
    "APKLUSINIET KANĀLU, VISUR", "“Mute channel everywhere” katra video ⋮ izvēlnē", "Pazūd no meklēšanas, sākumlapas, abonementiem un videoklipiem blakus tam, ko skatāties",
    "Pazūd arī tā Shorts, sākumlapā un meklēšanā", "Apklusiniet vārdus: pazūd ikviens video, kura nosaukumā ir kāds no tiem", "Atsauciet uzreiz, atceliet apklusināšanu jebkurā laikā un pārnesiet sarakstu no cita bloķētāja",
    "Sekojiet meklēšanai un katrā sīktēlā redziet, ko jau esat skatījies", "Cik garš ir jebkurš atskaņošanas saraksts un cik no tā vēl palicis",
    "YouTube meklēšana, kas zina, ko esat skatījies. Filtrējiet kanālus, sarakstus, vēsturi un Skatīties vēlāk. Apklusiniet kanālus."],
  ml: ["പുതിയത്: YouTube-ന്റെ സ്വന്തം ⋮ മെനുവിൽ നിന്ന് ഒരു ചാനൽ മ്യൂട്ട് ചെയ്യൂ, അത് തിരയൽ, ഹോം, സബ്‌സ്‌ക്രിപ്‌ഷനുകൾ, Shorts എന്നിവയിൽ നിന്ന് അപ്രത്യക്ഷമാകും. ചാനൽ ശുപാർശ ചെയ്യരുത് എന്ന YouTube ഓപ്ഷൻ തിരയലിനെ ഒരിക്കലും ബാധിക്കില്ല. ഇത് ബാധിക്കും.",
    "ചാനൽ മ്യൂട്ട് ചെയ്യൂ, എല്ലായിടത്തും", "ഓരോ വീഡിയോയുടെയും ⋮ മെനുവിൽ \"Mute channel everywhere\"", "തിരയൽ, ഹോം, സബ്‌സ്‌ക്രിപ്‌ഷനുകൾ, നിങ്ങൾ കാണുന്ന വീഡിയോയുടെ അരികിലെ വീഡിയോകൾ എന്നിവയിൽ നിന്ന് അപ്രത്യക്ഷം",
    "അതിന്റെ Shorts-ഉം പോകും, ഹോമിലും തിരയലിലും", "വാക്കുകൾ മ്യൂട്ട് ചെയ്യൂ: തലക്കെട്ടിൽ അവയിലൊന്നുള്ള ഏത് വീഡിയോയും അപ്രത്യക്ഷമാകും", "ഉടനെ പഴയപടിയാക്കൂ, എപ്പോൾ വേണമെങ്കിലും അൺമ്യൂട്ട് ചെയ്യൂ, മറ്റൊരു ബ്ലോക്കറിൽ നിന്ന് പട്ടിക കൊണ്ടുവരൂ",
    "ഒരു തിരയൽ ഫോളോ ചെയ്യൂ, ഓരോ തംബ്‌നെയിലിലും നിങ്ങൾ കണ്ടത് കാണൂ", "ഏത് പ്ലേലിസ്റ്റിന്റെയും ദൈർഘ്യം, അതിൽ ഇനി എത്ര ബാക്കിയുണ്ട് എന്നതും",
    "നിങ്ങൾ കണ്ടത് അറിയുന്ന YouTube തിരയൽ. ചാനൽ, പ്ലേലിസ്റ്റ്, ചരിത്രം, പിന്നീട് കാണുക ഫിൽട്ടർ ചെയ്യൂ. ചാനലുകൾ മ്യൂട്ട് ചെയ്യൂ."],
  mr: ["नवीन: YouTube च्या स्वतःच्या ⋮ मेनूमधून चॅनेल म्यूट करा, आणि ते शोध, होम, सदस्यता आणि Shorts मधून गायब होईल. चॅनेल न सुचवण्याचा YouTube चा पर्याय शोधाला कधीच स्पर्श करत नाही. हा करतो.",
    "चॅनेल म्यूट करा, सगळीकडे", "प्रत्येक व्हिडिओच्या ⋮ मेनूमध्ये \"Mute channel everywhere\"", "शोध, होम, सदस्यता आणि तुम्ही पाहत असलेल्या व्हिडिओशेजारील व्हिडिओंमधून गायब",
    "त्याचे Shorts सुद्धा जातात, होमवर आणि शोधात", "शब्द म्यूट करा: शीर्षकात त्यापैकी एखादा शब्द असलेला प्रत्येक व्हिडिओ गायब", "लगेच पूर्ववत करा, कधीही अनम्यूट करा, आणि दुसऱ्या ब्लॉकरमधून तुमची यादी आणा",
    "एखादा शोध फॉलो करा, आणि प्रत्येक थंबनेलवर तुम्ही काय पाहिले ते पहा", "कोणतीही प्लेलिस्ट किती लांब आहे, आणि त्यातली किती बाकी आहे",
    "तुम्ही काय पाहिले ते जाणणारा YouTube शोध. चॅनेल, प्लेलिस्ट, इतिहास आणि नंतर पहा फिल्टर करा. चॅनेल सगळीकडे म्यूट करा."],
  ms: ["Baharu: senyapkan saluran terus dari menu ⋮ YouTube sendiri, dan ia hilang daripada carian, Laman Utama, Langganan dan Shorts. Pilihan YouTube untuk tidak mengesyorkan saluran tidak pernah menyentuh carian. Yang ini menyentuh.",
    "SENYAPKAN SALURAN, DI MANA-MANA", "\"Mute channel everywhere\" dalam menu ⋮ setiap video", "Hilang daripada carian, Laman Utama, Langganan dan video di sebelah video yang anda tonton",
    "Shorts saluran itu juga hilang, di Laman Utama dan dalam carian", "Senyapkan perkataan: mana-mana video yang tajuknya mengandungi salah satunya hilang", "Buat asal serta-merta, nyahsenyap bila-bila masa, dan bawa senarai anda dari penyekat lain",
    "Ikuti carian, dan lihat apa yang telah anda tonton pada setiap lakaran kecil", "Berapa panjang mana-mana senarai main, dan berapa yang tinggal",
    "Carian YouTube yang tahu apa yang anda tonton. Tapis saluran, senarai main, sejarah dan Tonton Kemudian. Senyapkan saluran."],
  nl: ["Nieuw: demp een kanaal vanuit YouTubes eigen ⋮-menu, en het verdwijnt uit zoeken, de startpagina, abonnementen en Shorts. YouTubes optie om een kanaal niet meer aan te bevelen, raakt de zoekresultaten nooit. Deze wel.",
    "EEN KANAAL DEMPEN, OVERAL", "'Mute channel everywhere' in het ⋮-menu van elke video", "Weg uit zoeken, de startpagina, abonnementen en de video's naast de video die je kijkt",
    "Ook de Shorts gaan weg, op de startpagina en in zoeken", "Woorden dempen: elke video met zo'n woord in de titel verdwijnt", "Meteen ongedaan maken, wanneer je wilt weer tonen, en je lijst overzetten vanuit een andere blocker",
    "Volg een zoekopdracht en zie op elke thumbnail wat je al hebt gezien", "Hoe lang een playlist is, en hoeveel je er nog van over hebt",
    "De YouTube-zoekfunctie die weet wat je hebt gezien. Filter kanalen, playlists, geschiedenis en Later bekijken. Demp kanalen overal."],
  no: ["Nytt: demp en kanal rett fra YouTubes egen ⋮-meny, så forsvinner den fra søk, startsiden, abonnementer og Shorts. YouTubes valg om å ikke anbefale en kanal rører aldri søket. Dette gjør det.",
    "DEMP EN KANAL, OVERALT", "«Mute channel everywhere» i ⋮-menyen på hver video", "Borte fra søk, startsiden, abonnementer og videoene ved siden av den du ser på",
    "Shorts-ene forsvinner også, på startsiden og i søk", "Demp ord: alle videoer med ett av dem i tittelen forsvinner", "Angre med en gang, opphev dempingen når du vil, og hent listen din fra en annen blokkerer",
    "Følg et søk, og se hva du har sett på hvert miniatyrbilde", "Hvor lang en spilleliste er, og hvor mye du har igjen",
    "YouTube-søket som vet hva du har sett. Filtrer kanaler, spillelister, historikk og Se senere. Demp en kanal overalt."],
  pl: ["Nowość: wycisz kanał prosto z menu ⋮ samego YouTube, a zniknie z wyszukiwania, strony głównej, subskrypcji i Shorts. Opcja YouTube, by nie polecać kanału, nigdy nie dotyczy wyszukiwania. Ta tak.",
    "WYCISZ KANAŁ, WSZĘDZIE", "„Mute channel everywhere” w menu ⋮ każdego filmu", "Znika z wyszukiwania, strony głównej, subskrypcji i z filmów obok tego, który oglądasz",
    "Znikają też jego Shorts, na stronie głównej i w wyszukiwaniu", "Wyciszanie słów: znika każdy film, który ma jedno z nich w tytule", "Cofnij od razu, wyłącz wyciszenie kiedy chcesz i przenieś listę z innego blokera",
    "Obserwuj wyszukiwanie i zobacz na każdej miniaturze, co już obejrzałeś", "Ile trwa dowolna playlista i ile z niej jeszcze zostało",
    "Wyszukiwarka YouTube, która wie, co obejrzałeś. Filtruj kanały, playlisty, historię i Do obejrzenia. Wycisz kanał wszędzie."],
  pt_BR: ["Novo: silencie um canal no próprio menu ⋮ do YouTube, e ele some da busca, do início, das inscrições e dos Shorts. A opção do YouTube de não recomendar um canal nunca afeta a busca. Esta afeta.",
    "SILENCIE UM CANAL, EM TODO LUGAR", "\"Mute channel everywhere\" no menu ⋮ de cada vídeo", "Some da busca, do início, das inscrições e dos vídeos ao lado do que você está assistindo",
    "Os Shorts dele também somem, no início e na busca", "Silencie palavras: qualquer vídeo com uma delas no título desaparece", "Desfaça na hora, tire o silêncio quando quiser e traga sua lista de outro bloqueador",
    "Siga uma busca e veja o que você já assistiu em cada miniatura", "Quanto dura qualquer playlist, e quanto falta para você",
    "A busca do YouTube que sabe o que você assistiu. Filtre canais, playlists, histórico e Assistir mais tarde. Silencie canais."],
  pt_PT: ["Novo: silencie um canal a partir do próprio menu ⋮ do YouTube, e desaparece da pesquisa, do início, das subscrições e dos Shorts. A opção do YouTube de não recomendar um canal nunca afeta a pesquisa. Esta afeta.",
    "SILENCIE UM CANAL, EM TODO O LADO", "\"Mute channel everywhere\" no menu ⋮ de cada vídeo", "Desaparece da pesquisa, do início, das subscrições e dos vídeos ao lado do que está a ver",
    "Os Shorts dele também desaparecem, no início e na pesquisa", "Silencie palavras: qualquer vídeo com uma delas no título desaparece", "Anule logo, deixe de silenciar quando quiser e traga a sua lista de outro bloqueador",
    "Siga uma pesquisa e veja o que já viu em cada miniatura", "Quanto dura qualquer playlist, e quanto lhe falta",
    "A pesquisa do YouTube que sabe o que já viu. Filtre canais, playlists, histórico e Ver mais tarde. Silencie um canal em todo o lado."],
  ro: ["Nou: ascunde un canal direct din meniul ⋮ al YouTube, iar acesta dispare din căutare, pagina principală, abonamente și Shorts. Opțiunea YouTube de a nu recomanda un canal nu atinge niciodată căutarea. Aceasta da.",
    "ASCUNDE UN CANAL, PESTE TOT", "„Mute channel everywhere” în meniul ⋮ al fiecărui videoclip", "Dispare din căutare, pagina principală, abonamente și videoclipurile de lângă cel pe care îl urmărești",
    "Dispar și Shorts-urile lui, pe pagina principală și în căutare", "Ascunde cuvinte: orice videoclip cu unul dintre ele în titlu dispare", "Anulează imediat, readu-l oricând și adu-ți lista dintr-un alt blocant",
    "Urmărește o căutare și vezi pe fiecare miniatură ce ai văzut deja", "Cât durează orice playlist și cât ți-a mai rămas din el",
    "Căutarea YouTube care știe ce ai văzut. Filtrează canale, playlisturi, istoricul și Vizionează mai târziu. Ascunde canale."],
  ru: ["Новое: скройте канал прямо из меню ⋮ самого YouTube, и он исчезнет из поиска, главной, подписок и Shorts. Опция YouTube «не рекомендовать канал» никогда не влияет на поиск. Эта влияет.",
    "СКРОЙТЕ КАНАЛ, ВЕЗДЕ", "«Mute channel everywhere» в меню ⋮ каждого видео", "Исчезает из поиска, с главной, из подписок и из видео рядом с тем, что вы смотрите",
    "Его Shorts тоже исчезают, на главной и в поиске", "Скрытие по словам: исчезает любое видео, в названии которого есть одно из них", "Отмените сразу, верните в любой момент и перенесите список из другого блокировщика",
    "Следите за поиском и видите на каждой миниатюре, что вы уже смотрели", "Сколько длится любой плейлист и сколько вам осталось",
    "Поиск YouTube, который знает, что вы смотрели. Фильтруйте каналы, плейлисты, историю и «Смотреть позже». Скрывайте каналы."],
  sk: ["Novinka: stlmte kanál priamo z ponuky ⋮ na YouTube a zmizne z vyhľadávania, domovskej stránky, odberov aj Shorts. Možnosť YouTube neodporúčať kanál nikdy neovplyvní vyhľadávanie. Toto áno.",
    "STLMTE KANÁL, VŠADE", "„Mute channel everywhere“ v ponuke ⋮ pri každom videu", "Zmizne z vyhľadávania, domovskej stránky, odberov aj z videí vedľa toho, ktoré pozeráte",
    "Zmiznú aj jeho Shorts, na domovskej stránke aj vo vyhľadávaní", "Stlmenie slov: každé video, ktoré má také slovo v názve, zmizne", "Okamžite vráťte späť, kedykoľvek zrušte stlmenie a preneste zoznam z iného blokovača",
    "Sledujte vyhľadávanie a na každej miniatúre uvidíte, čo ste už videli", "Aký dlhý je akýkoľvek playlist a koľko vám z neho zostáva",
    "Vyhľadávanie na YouTube, ktoré vie, čo ste videli. Filtrujte kanály, playlisty, históriu a Pozrieť neskôr. Stlmte kanál všade."],
  sl: ["Novo: utišajte kanal kar iz YouTubovega menija ⋮ in izgine iz iskanja, domače strani, naročnin in Shorts. YouTubova možnost, da kanala ne priporoča, nikoli ne vpliva na iskanje. Ta vpliva.",
    "UTIŠAJTE KANAL, POVSOD", "»Mute channel everywhere« v meniju ⋮ vsakega videoposnetka", "Izgine iz iskanja, z domače strani, iz naročnin in iz videoposnetkov ob tistem, ki ga gledate",
    "Izginejo tudi njegovi Shorts, na domači strani in v iskanju", "Utišajte besede: izgine vsak videoposnetek, ki ima v naslovu katero od njih", "Takoj razveljavite, kadar koli prekličite utišanje in prenesite seznam iz drugega blokatorja",
    "Spremljajte iskanje in na vsaki sličici vidite, kaj ste si že ogledali", "Kako dolg je kateri koli seznam predvajanja in koliko vam ga še ostane",
    "Iskanje v YouTubu, ki ve, kaj ste si ogledali. Filtrirajte kanale, sezname, zgodovino in Ogled pozneje. Utišajte kanal povsod."],
  sr: ["Ново: утишајте канал директно из YouTube менија ⋮ и нестаје из претраге, почетне стране, пријава и Shorts снимака. YouTube опција да не препоручује канал никад не утиче на претрагу. Ова утиче.",
    "УТИШАЈТЕ КАНАЛ, СВУДА", "„Mute channel everywhere“ у менију ⋮ сваког видеа", "Нестаје из претраге, са почетне стране, из пријава и из видеа поред оног који гледате",
    "Нестају и његови Shorts, на почетној страни и у претрази", "Утишајте речи: сваки видео са неком од њих у наслову нестаје", "Опозовите одмах, укините утишавање кад год желите и пренесите листу из другог блокатора",
    "Пратите претрагу и на свакој сличици видите шта сте већ гледали", "Колико траје било која плејлиста и колико вам је од ње остало",
    "YouTube претрага која зна шта сте гледали. Филтрирајте канале, плејлисте, историју и „Погледај касније“. Утишајте канал свуда."],
  sv: ["Nytt: tysta en kanal direkt från YouTubes egen ⋮-meny, så försvinner den från sökningen, startsidan, prenumerationer och Shorts. YouTubes val att inte rekommendera en kanal påverkar aldrig sökningen. Det här gör det.",
    "TYSTA EN KANAL, ÖVERALLT", "”Mute channel everywhere” i ⋮-menyn på varje video", "Borta från sökningen, startsidan, prenumerationer och videorna bredvid den du tittar på",
    "Dess Shorts försvinner också, på startsidan och i sökningen", "Tysta ord: alla videor med ett av dem i titeln försvinner", "Ångra direkt, slå av tystningen när du vill och ta med din lista från en annan blockerare",
    "Följ en sökning och se på varje miniatyr vad du redan har sett", "Hur lång en spellista är och hur mycket du har kvar",
    "YouTube-sökningen som vet vad du har sett. Filtrera kanaler, spellistor, historik och Titta senare. Tysta en kanal överallt."],
  sw: ["Mpya: nyamazisha chaneli moja kwa moja kutoka menyu ya ⋮ ya YouTube yenyewe, nayo itatoweka kwenye utafutaji, Mwanzo, Usajili na Shorts. Chaguo la YouTube la kutopendekeza chaneli haligusi utafutaji kamwe. Hili linagusa.",
    "NYAMAZISHA CHANELI, KILA MAHALI", "\"Mute channel everywhere\" kwenye menyu ya ⋮ ya kila video", "Inatoweka kwenye utafutaji, Mwanzo, Usajili na video zilizo kando ya unayotazama",
    "Shorts zake pia zinaondoka, kwenye Mwanzo na kwenye utafutaji", "Nyamazisha maneno: video yoyote yenye mojawapo kwenye kichwa chake inatoweka", "Tendua papo hapo, ondoa unyamazishaji wakati wowote, na leta orodha yako kutoka kizuizi kingine",
    "Fuatilia utafutaji, na uone kwenye kila picha ndogo ulichokwisha kutazama", "Urefu wa orodha yoyote ya kucheza, na kiasi kilichobaki kwako",
    "Utafutaji wa YouTube unaojua ulichotazama. Chuja chaneli, orodha za kucheza, historia na Tazama Baadaye. Nyamazisha chaneli."],
  ta: ["புதியது: YouTube-இன் சொந்த ⋮ மெனுவிலிருந்து ஒரு சேனலை மியூட் செய்யுங்கள், அது தேடல், முகப்பு, சந்தாக்கள், Shorts ஆகியவற்றிலிருந்து மறைந்துவிடும். சேனலைப் பரிந்துரைக்க வேண்டாம் என்ற YouTube விருப்பம் தேடலைத் தொடுவதே இல்லை. இது தொடும்.",
    "சேனலை மியூட் செய்யுங்கள், எல்லா இடத்திலும்", "ஒவ்வொரு வீடியோவின் ⋮ மெனுவிலும் \"Mute channel everywhere\"", "தேடல், முகப்பு, சந்தாக்கள், நீங்கள் பார்க்கும் வீடியோவின் அருகிலுள்ள வீடியோக்கள் ஆகியவற்றிலிருந்து மறையும்",
    "அதன் Shorts-உம் போய்விடும், முகப்பிலும் தேடலிலும்", "சொற்களை மியூட் செய்யுங்கள்: தலைப்பில் அவற்றில் ஒன்று உள்ள எந்த வீடியோவும் மறையும்", "உடனே செயல்தவிர்க்கவும், எப்போது வேண்டுமானாலும் அன்மியூட் செய்யவும், வேறொரு பிளாக்கரிலிருந்து பட்டியலைக் கொண்டு வரவும்",
    "ஒரு தேடலைப் பின்தொடர்ந்து, ஒவ்வொரு சிறுபடத்திலும் நீங்கள் பார்த்ததைக் காணுங்கள்", "எந்த பிளேலிஸ்ட்டும் எவ்வளவு நீளம், அதில் இன்னும் எவ்வளவு மீதம் உள்ளது",
    "நீங்கள் பார்த்ததை அறிந்த YouTube தேடல். சேனல், பிளேலிஸ்ட், வரலாறு, பிறகு பார்க்க வடிகட்டுங்கள். சேனலை எங்கும் மியூட் செய்யுங்கள்."],
  te: ["కొత్తది: YouTube సొంత ⋮ మెనూ నుండి ఛానెల్‌ను మ్యూట్ చేయండి, అది శోధన, హోమ్, సబ్‌స్క్రిప్షన్‌లు, Shorts నుండి మాయమవుతుంది. ఛానెల్‌ను సిఫార్సు చేయవద్దనే YouTube ఎంపిక శోధనను ఎప్పుడూ తాకదు. ఇది తాకుతుంది.",
    "ఛానెల్‌ను మ్యూట్ చేయండి, అన్ని చోట్లా", "ప్రతి వీడియో ⋮ మెనూలో \"Mute channel everywhere\"", "శోధన, హోమ్, సబ్‌స్క్రిప్షన్‌లు, మీరు చూస్తున్న వీడియో పక్కన ఉన్న వీడియోల నుండి మాయం",
    "దాని Shorts కూడా పోతాయి, హోమ్‌లో మరియు శోధనలో", "పదాలను మ్యూట్ చేయండి: శీర్షికలో వాటిలో ఒకటి ఉన్న ఏ వీడియో అయినా మాయం", "వెంటనే రద్దు చేయండి, ఎప్పుడైనా అన్‌మ్యూట్ చేయండి, మరో బ్లాకర్ నుండి మీ జాబితాను తీసుకురండి",
    "ఒక శోధనను ఫాలో చేయండి, ప్రతి థంబ్‌నెయిల్‌పై మీరు ఏం చూశారో చూడండి", "ఏ ప్లేలిస్ట్ అయినా ఎంత నిడివి, అందులో ఇంకా ఎంత మిగిలి ఉంది",
    "మీరు ఏం చూశారో తెలిసిన YouTube శోధన. ఛానెల్స్, ప్లేలిస్ట్‌లు, చరిత్ర, తర్వాత చూడండి ఫిల్టర్ చేయండి. ఛానెల్‌ను మ్యూట్ చేయండి."],
  th: ["ใหม่: ซ่อนช่องได้จากเมนู ⋮ ของ YouTube เอง แล้วช่องนั้นจะหายไปจากการค้นหา หน้าแรก การติดตาม และ Shorts ตัวเลือกไม่แนะนำช่องของ YouTube ไม่เคยมีผลกับการค้นหา แต่อันนี้มีผล",
    "ซ่อนช่อง ทุกที่", "\"Mute channel everywhere\" ในเมนู ⋮ ของทุกวิดีโอ", "หายไปจากการค้นหา หน้าแรก การติดตาม และวิดีโอข้างๆ ที่คุณกำลังดู",
    "Shorts ของช่องก็หายไปด้วย ทั้งในหน้าแรกและการค้นหา", "ซ่อนด้วยคำ: วิดีโอใดที่มีคำนั้นในชื่อจะหายไป", "เลิกทำได้ทันที ยกเลิกการซ่อนได้ทุกเมื่อ และย้ายรายการมาจากตัวบล็อกอื่น",
    "ติดตามการค้นหา และดูบนทุกภาพขนาดย่อว่าคุณดูอะไรไปแล้ว", "เพลย์ลิสต์ใดๆ ยาวเท่าไร และเหลืออีกเท่าไร",
    "การค้นหา YouTube ที่รู้ว่าคุณดูอะไรไปแล้ว กรองช่อง เพลย์ลิสต์ ประวัติ และดูภายหลัง ซ่อนช่องได้ทุกที่"],
  tr: ["Yeni: Bir kanalı YouTube'un kendi ⋮ menüsünden sessize alın; arama, ana sayfa, abonelikler ve Shorts'tan kaybolsun. YouTube'un kanalı önermeme seçeneği aramayı hiç etkilemez. Bu etkiler.",
    "BİR KANALI SESSİZE ALIN, HER YERDE", "Her videonun ⋮ menüsünde \"Mute channel everywhere\"", "Aramadan, ana sayfadan, aboneliklerden ve izlediğiniz videonun yanındakilerden kaybolur",
    "Shorts videoları da gider, ana sayfada ve aramada", "Kelimeleri sessize alın: başlığında bunlardan biri geçen her video kaybolur", "Hemen geri alın, istediğiniz zaman sessizden çıkarın ve listenizi başka bir engelleyiciden getirin",
    "Bir aramayı takip edin ve her küçük resimde neyi izlediğinizi görün", "Herhangi bir oynatma listesinin uzunluğu ve ne kadarının kaldığı",
    "Neleri izlediğinizi bilen YouTube araması. Kanalları, listeleri, geçmişi ve Daha sonra izle'yi filtreleyin. Kanalları sessize alın."],
  uk: ["Нове: приховайте канал просто з меню ⋮ самого YouTube, і він зникне з пошуку, головної, підписок і Shorts. Опція YouTube не рекомендувати канал ніколи не впливає на пошук. Ця впливає.",
    "ПРИХОВАЙТЕ КАНАЛ, СКРІЗЬ", "«Mute channel everywhere» у меню ⋮ кожного відео", "Зникає з пошуку, головної, підписок і з відео поруч із тим, що ви дивитеся",
    "Його Shorts теж зникають, на головній і в пошуку", "Приховування за словами: зникає будь-яке відео, у назві якого є одне з них", "Скасуйте одразу, поверніть будь-коли та перенесіть список з іншого блокувальника",
    "Стежте за пошуком і бачте на кожній мініатюрі, що ви вже дивилися", "Скільки триває будь-який плейлист і скільки вам ще лишилося",
    "Пошук YouTube, який знає, що ви дивилися. Фільтруйте канали, плейлисти, історію і «Переглянути пізніше». Приховуйте канали."],
  vi: ["Mới: ẩn một kênh ngay từ menu ⋮ của chính YouTube, kênh đó sẽ biến mất khỏi tìm kiếm, Trang chủ, Kênh đăng ký và Shorts. Tùy chọn không đề xuất kênh của YouTube không bao giờ tác động đến tìm kiếm. Cái này thì có.",
    "ẨN MỘT KÊNH, Ở MỌI NƠI", "\"Mute channel everywhere\" trong menu ⋮ của mọi video", "Biến mất khỏi tìm kiếm, Trang chủ, Kênh đăng ký và các video bên cạnh video bạn đang xem",
    "Shorts của kênh cũng biến mất, ở Trang chủ và trong tìm kiếm", "Ẩn theo từ: mọi video có một trong các từ đó trong tiêu đề sẽ biến mất", "Hoàn tác ngay, bỏ ẩn bất cứ lúc nào, và chuyển danh sách từ trình chặn khác sang",
    "Theo dõi một tìm kiếm, và thấy trên mỗi hình thu nhỏ những gì bạn đã xem", "Danh sách phát bất kỳ dài bao lâu, và bạn còn lại bao nhiêu",
    "Tìm kiếm YouTube biết bạn đã xem gì. Lọc kênh, danh sách phát, lịch sử và Xem sau. Ẩn một kênh ở mọi nơi."],
  zh_CN: ["新功能：直接在 YouTube 自己的 ⋮ 菜单里屏蔽一个频道，它就会从搜索、首页、订阅和 Shorts 中消失。YouTube 的“不推荐此频道”从来管不到搜索，这个可以。",
    "屏蔽频道，处处生效", "每个视频的 ⋮ 菜单里都有“Mute channel everywhere”", "从搜索、首页、订阅以及你正在看的视频旁边的推荐中消失",
    "它的 Shorts 也会消失，首页和搜索里都是", "屏蔽关键词：标题里含有这些词的视频都会消失", "可立即撤销，随时取消屏蔽，还能从其他屏蔽工具导入名单",
    "关注一个搜索，并在每个缩略图上看到你看过什么", "任何播放列表的总时长，以及还剩多少",
    "记得你看过什么的 YouTube 搜索。筛选频道、播放列表、观看记录和稍后观看。处处屏蔽频道。"],
  zh_TW: ["新功能：直接在 YouTube 自己的 ⋮ 選單封鎖頻道，它就會從搜尋、首頁、訂閱內容和 Shorts 中消失。YouTube 的「不要推薦這個頻道」從來管不到搜尋，這個可以。",
    "封鎖頻道，處處生效", "每部影片的 ⋮ 選單裡都有「Mute channel everywhere」", "從搜尋、首頁、訂閱內容，以及你正在看的影片旁邊消失",
    "它的 Shorts 也會消失，首頁和搜尋都是", "封鎖關鍵字：標題含有這些字的影片都會消失", "可立即復原，隨時解除封鎖，還能從其他封鎖工具匯入清單",
    "追蹤一個搜尋，並在每張縮圖上看到你看過什麼", "任何播放清單的總長度，以及還剩多少",
    "記得你看過什麼的 YouTube 搜尋。篩選頻道、播放清單、觀看記錄和「稍後觀看」。處處封鎖頻道。"],
};

const problems = [], done = [];
for (const [lang, t] of Object.entries(T)) {
  if (t.length !== 10) { problems.push(`${lang}: ${t.length} strings, not 10`); continue; }
  const [nw, head, m1, m2, m3, m4, m5, follow, plen, summary] = t;
  const len = [...summary].length;
  if (len > 132) { problems.push(`${lang}: summary is ${len} characters, over 132`); continue; }
  // the listing
  const file = path.join(DIR, lang + ".txt");
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
  if (text.startsWith(nw)) { done.push(lang + " (listing already 2.3)"); }
  else {
    const blocks = text.split(/\n\n+/);
    if (blocks.length !== 10) { problems.push(`${lang}: listing has ${blocks.length} paragraphs, not 10`); continue; }
    const search = blocks[1].split("\n"), lists = blocks[4].split("\n");
    if (!search[search.length - 1].startsWith("- ") || !lists[1].startsWith("- ")) { problems.push(`${lang}: sections not where expected`); continue; }
    search[search.length - 1] = "- " + follow;
    lists.splice(1, 0, "- " + plen);
    const mute = [head, ...[m1, m2, m3, m4, m5].map((m) => "- " + m)].join("\n");
    const out = [nw, blocks[0], mute, search.join("\n"), blocks[2], blocks[3], lists.join("\n"), ...blocks.slice(5)].join("\n\n") + "\n";
    if (!DRY) fs.writeFileSync(file, out);
  }
  // the summary inside the extension
  const mfile = path.join(LOCALES, lang, "messages.json");
  const raw = fs.readFileSync(mfile, "utf8");
  const m = JSON.parse(raw);
  if (m.extDesc.message !== summary) {
    m.extDesc.message = summary;
    if (!DRY) fs.writeFileSync(mfile, JSON.stringify(m, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  }
  done.push(`${lang} ${len}`);
}
console.log(`${DRY ? "would update" : "updated"}: ${done.join(", ")}`);
if (problems.length) { console.log("PROBLEMS:\n  " + problems.join("\n  ")); process.exit(1); }

// paste.html carries its own copy of every listing, and remembers which were pasted per version: it is rebuilt from
// the files, for 2.3.0, with nothing ticked yet.
const PASTE = path.join(DIR, "paste.html");
let page = fs.readFileSync(PASTE, "utf8");
const at = page.indexOf("const items = "), end = page.indexOf(";\n", at);
const items = JSON.parse(page.slice(at + "const items = ".length, end));
for (const it of items) it.d = fs.readFileSync(path.join(DIR, it.code + ".txt"), "utf8").replace(/\r\n/g, "\n").trim();
page = page.slice(0, at) + "const items = " + JSON.stringify(items) + page.slice(end)
  .replace(/needle-paste-[\d.]+/, "needle-paste-2.3.0");
page = page.replace(/Needle store listing for [\d.]+/, "Needle store listing for 2.3.0").replace(/needle-paste-[\d.]+/, "needle-paste-2.3.0");
if (!DRY) fs.writeFileSync(PASTE, page);
console.log(`${DRY ? "would rebuild" : "rebuilt"} paste.html: ${items.length} listings, for 2.3.0`);
