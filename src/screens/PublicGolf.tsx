import "../styles/public-home.css";
import { PublicHeader } from "../components/PublicHeader";
import { PublicFooter } from "../components/PublicFooter";
import { usePageMeta } from "../lib/usePageMeta";

type GolfProperty = {
  slug: string;
  name: string;
  image: string;
  alt: string;
  copy: string[];
};

const PROPERTIES: GolfProperty[] = [
  {
    slug: "tubac",
    name: "Tubac",
    image: "/photography/collage/tubac-aerial.jpg",
    alt: "Tubac desert landscape, aerial view",
    copy: [
      "Tubac sits in the Santa Cruz River valley of southern Arizona, framed by open desert and low mountain ranges.",
      "The town carries a genuine, well-worn history — a historic small-town character that predates the golf and gives the setting its own sense of place.",
    ],
  },
  {
    slug: "sedona",
    name: "Sedona",
    image: "/photography/collage/sedona-golf.jpg",
    alt: "Sedona red rock landscape",
    copy: [
      "Sedona is red rock country — towering sandstone formations, deep canyons, and light that shifts color through the day.",
      "It's one of the most distinctive landscapes in the Southwest, and the setting carries the experience on its own.",
    ],
  },
  {
    slug: "birdie-ranch",
    name: "Birdie Ranch",
    image: "/photography/collage/birdie-ranch.jpg",
    alt: "Birdie Ranch open ranch landscape",
    copy: [
      "Birdie Ranch opens onto big sky country — rolling ranch land dotted with juniper under wide, open horizons.",
      "The greens are the signature feature here, set against that open ranch landscape rather than tucked away.",
    ],
  },
  {
    slug: "bison-golf-club",
    name: "Bison Golf Club",
    image: "/photography/collage/bison-golf-club.jpg",
    alt: "Bison Golf Club fairway",
    copy: [
      "Bison Golf Club sits inside a pine forest in a mountain town, where the tree line gives the course real depth.",
      "Fairways wind through the trees, following the natural contours of the land rather than running straight and open.",
    ],
  },
];

export function PublicGolf() {
  usePageMeta(
    "Hospitality & Golf | The Lab Property Company",
    "The Lab's hospitality and golf portfolio: Tubac, Sedona, Birdie Ranch, and Bison Golf Club."
  );
  return (
    <div className="ph">
      <div className="ph__hero">
        <PublicHeader />

        <div className="ph__inner ph__hero-primary">
          <p className="ph__hero-eyebrow">Hospitality &amp; Golf</p>
          <h1 className="ph__h1">Four properties. One relaxed standard.</h1>
          <p className="ph__hero-sub">
            The golf is excellent. The attitude isn't exclusive.
          </p>
        </div>

        <div className="ph__hero-evidence">
          <img
            src="/photography/collage/birdie-ranch.jpg"
            alt="Birdie Ranch open ranch landscape"
          />
          <div className="ph__hero-evidence-caption">
            <span className="dot" />
            Birdie Ranch
          </div>
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
                <img src={property.image} alt={property.alt} loading="lazy" />
              </div>
              <div className="ph__golf-property-copy">
                <h2 className="ph__section-title">{property.name}</h2>
                {property.copy.map((paragraph, j) => (
                  <p key={j}>{paragraph}</p>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="ph__closing">
        <div className="ph__inner">
          <p className="ph__closing-final">
            Get in touch<span className="dot">.</span>
          </p>
          <p className="ph__closing-explain">
            For leasing, ownership, or general inquiries, contact The Lab
            Property Company using the details below.
          </p>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
