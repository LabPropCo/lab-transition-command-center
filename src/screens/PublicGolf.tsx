import "../styles/public-home.css";
import { PublicHeader } from "../components/PublicHeader";
import { PublicFooter } from "../components/PublicFooter";
import { usePageMeta } from "../lib/usePageMeta";

type GolfProperty = {
  slug: string;
  name: string;
  location: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  imagePosition: string;
  alt: string;
  copy: string;
};

const PROPERTIES: GolfProperty[] = [
  {
    slug: "tubac",
    name: "Tubac Golf Resort & Spa",
    location: "Tubac, Arizona",
    image: "Tubac_Bedroom",
    imageWidth: 1280,
    imageHeight: 853,
    imagePosition: "center center",
    alt: "Tubac guest room with fireplace",
    copy: "Golf in Tubac starts with a ranch. The land traces back to a 1789 Spanish land grant, and the resort has welcomed guests since 1959. Today it's 27 holes in the Santa Cruz Valley, 98 hacienda-style rooms, and a full-service spa. And yes, it's the course from Tin Cup.",
  },
  {
    slug: "sedona",
    name: "Sedona Golf Resort",
    location: "Sedona, Arizona",
    image: "Sedona_Golf_1",
    imageWidth: 1600,
    imageHeight: 1066,
    imagePosition: "center 30%",
    alt: "Golfer teeing off at Sedona Golf Resort with red rocks behind",
    copy: "A par-71 Gary Panks design set among Sedona's red rock formations, and consistently ranked among Arizona's finest public courses. Fair warning: you'll stop to take pictures.",
  },
  {
    slug: "birdie-ranch",
    name: "Birdie Ranch Golf Club",
    location: "Show Low, Arizona",
    image: "Birdie_Ranch",
    imageWidth: 1500,
    imageHeight: 1000,
    imagePosition: "center center",
    alt: "Golfer swinging at Birdie Ranch Golf Club",
    copy: "Gary Panks designed this one too, back when it was called Silver Creek. Big skies, open juniper country, and greens worth the trip. It's the only year-round course in the White Mountains, so the season never really ends.",
  },
  {
    slug: "bison-golf-club",
    name: "Bison Golf Club",
    location: "Show Low, Arizona",
    image: "Bison_Golf_Club",
    imageWidth: 1600,
    imageHeight: 1066,
    imagePosition: "center center",
    alt: "Golfer on a pine-lined fairway at Bison Golf Club",
    copy: "Bison is golf in the pines. Originally designed by Jack Snyder and redesigned by PGA Tour player Billy Mayfair in 2006, it winds through tall forest on its way back to the Bison Bar & Grill. Open spring through fall, with a driving range and pro shop.",
  },
];

const HOW_WE_RUN = [
  {
    title: "Details first.",
    copy: "Greens, pace of play, the welcome at the pro shop. Small things decide whether a round feels great, so we manage them like they matter.",
  },
  {
    title: "Golf for everyone.",
    copy: "First-timers, families, and low handicappers all belong here. The golf is excellent. The attitude isn't exclusive.",
  },
  {
    title: "Respect for the place.",
    copy: "Every property has its own history and landscape. We protect what makes each one special and keep improving what guests experience.",
  },
];

export function PublicGolf() {
  usePageMeta(
    "Hospitality & Golf | The Lab Property Company",
    "Four Arizona golf properties, from historic desert resorts to high-country clubs, run with The Lab's standards."
  );
  return (
    <div className="ph">
      <div className="ph__hero">
        <PublicHeader />

        <div className="ph__inner ph__hero-primary">
          <p className="ph__hero-eyebrow">Hospitality &amp; Golf</p>
          <h1 className="ph__h1 ph__h1--wide">
            Serious about the details. Easy about everything else.
          </h1>
          <p className="ph__hero-sub">
            We bring the same standards that run our multifamily communities
            to four Arizona golf properties, from historic desert resorts to
            high-country clubs. Our job is to sweat the small stuff so every
            round feels easy, whether it's your hundredth or your first.
          </p>
        </div>

        <div className="ph__hero-evidence">
          <picture>
            <source type="image/webp" srcSet="/photography/golf/Tubac_Aerial.webp" />
            <img
              src="/photography/golf/Tubac_Aerial.jpg"
              width={1280}
              height={720}
              alt="Tubac Golf Resort & Spa aerial view at sunset"
              loading="eager"
              {...{ fetchpriority: "high" }}
            />
          </picture>
        </div>
      </div>

      <div className="ph__inner ph__section ph__golf-run">
        <p className="ph__section-eyebrow">How We Run Golf</p>
        <div className="ph__golf-run-grid">
          {HOW_WE_RUN.map((item) => (
            <div key={item.title}>
              <h2 className="ph__golf-run-title">{item.title}</h2>
              <p>{item.copy}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="ph__golf-properties">
        {PROPERTIES.map((property, i) => (
          <div
            className={`ph__inner ph__section ph__golf-property${i % 2 === 1 ? " ph__golf-property--reverse" : ""}`}
            id={property.slug}
            key={property.slug}
          >
            <div className="ph__golf-property-grid">
              <div className="ph__golf-property-photo">
                <picture>
                  <source type="image/webp" srcSet={`/photography/golf/${property.image}.webp`} />
                  <img
                    src={`/photography/golf/${property.image}.jpg`}
                    width={property.imageWidth}
                    height={property.imageHeight}
                    alt={property.alt}
                    loading="lazy"
                    style={{ objectPosition: property.imagePosition }}
                  />
                </picture>
              </div>
              <div className="ph__golf-property-copy">
                <p className="ph__section-eyebrow">{property.location}</p>
                <h2 className="ph__section-title">{property.name}</h2>
                <p>{property.copy}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="ph__closing">
        <div className="ph__inner">
          <p className="ph__closing-final">
            Come play. Bring someone new<span className="dot">.</span>
          </p>
          <p className="ph__closing-explain">
            Want to learn more about how we operate? We'd love to talk.
          </p>
          <a className="ph__btn" href="mailto:jking@labpropco.com">Contact Us</a>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
