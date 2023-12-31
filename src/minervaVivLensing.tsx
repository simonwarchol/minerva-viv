import { LensExtension } from "@hms-dbmi/viv";
import { VivView } from "@hms-dbmi/viv";
import { CompositeLayer, COORDINATE_SYSTEM } from "@deck.gl/core";
import {
  ScatterplotLayer,
  PolygonLayer,
  SolidPolygonLayer,
} from "@deck.gl/layers";
import { MultiscaleImageLayer, ImageLayer } from "@vivjs/layers";

const defaultProps = {
  lensEnabled: { type: "boolean", value: false, compare: true },
  lensSelection: { type: "number", value: 0, compare: true },
  lensRadius: { type: "number", value: 100, compare: true },
  lensOpacity: { type: "number", value: 1.0, compare: true },
  lensBorderColor: { type: "array", value: [255, 255, 255], compare: true },
  lensBorderRadius: { type: "number", value: 0.02, compare: true },
  colors: { type: "array", value: null, compare: true },
};

const fs = `\
// lens bounds for ellipse
uniform float majorLensAxis;
uniform float minorLensAxis;
uniform vec2 lensCenter;

// lens uniforms
uniform bool lensEnabled;
uniform int lensSelection;
uniform vec3 lensBorderColor;
uniform float lensOpacity;
uniform float lensBorderRadius;

// color palette
uniform vec3 colors[6];

bool frag_in_lens_bounds(vec2 vTexCoord) {
  // Check membership in what is (not visually, but effectively) an ellipse.
  // Since the fragment space is a unit square and the real coordinates could be longer than tall,
  // to get a circle visually we have to treat the check as that of an ellipse to get the effect of a circle.

  // Check membership in ellipse.
  return pow((lensCenter.x - vTexCoord.x) / majorLensAxis, 2.) + pow((lensCenter.y - vTexCoord.y) / minorLensAxis, 2.) < (1. - lensBorderRadius);
}

bool frag_on_lens_bounds(vec2 vTexCoord) {
  // Same as the above, except this checks the boundary.

  float ellipseDistance = pow((lensCenter.x - vTexCoord.x) / majorLensAxis, 2.) + pow((lensCenter.y - vTexCoord.y) / minorLensAxis, 2.);

  // Check membership on "bourndary" of ellipse.
  return ellipseDistance <= 1. && ellipseDistance >= (1. - lensBorderRadius);
}

// gets color relative to lens selection and lens opacity
vec3 get_color(vec2 vTexCoord, int channelIndex) {
  bool isFragInLensBounds = frag_in_lens_bounds(vTexCoord);
  bool inLensAndUseLens = lensEnabled && isFragInLensBounds;
  bool isSelectedChannel = channelIndex == lensSelection;
  float factorOutside = 1.0 - float(isSelectedChannel);
  float factorInside = isSelectedChannel ? lensOpacity : (1.0 - lensOpacity);
  float factor = inLensAndUseLens ? factorInside : factorOutside;
  return factor * colors[channelIndex];
}


void mutate_color(inout vec3 rgb, float intensity0, float intensity1, float intensity2, float intensity3, float intensity4, float intensity5, vec2 vTexCoord){

  rgb += max(0., min(1., intensity0)) * get_color(vTexCoord, 0);
  rgb += max(0., min(1., intensity1)) * get_color(vTexCoord, 1);
  rgb += max(0., min(1., intensity2)) * get_color(vTexCoord, 2);
  rgb += max(0., min(1., intensity3)) * get_color(vTexCoord, 3);
  rgb += max(0., min(1., intensity4)) * get_color(vTexCoord, 4);
  rgb += max(0., min(1., intensity5)) * get_color(vTexCoord, 5);


}
`;

function getImageLayer(id, props) {
  const { loader } = props;
  // Grab name of PixelSource if a class instance (works for Tiff & Zarr).
  const sourceName = loader[0]?.constructor?.name;

  // Create at least one layer even without selections so that the tests pass.
  const Layer = loader.length > 1 ? MultiscaleImageLayer : ImageLayer;
  const layerLoader = loader.length > 1 ? loader : loader[0];

  return new Layer({
    ...props,
    id: `${sourceName}${getVivId(id)}`,
    viewportId: id,
    loader: layerLoader,
  });
}

function getVivId(id) {
  return `-#${id}#`;
}

const MinervaVivLensing = class extends LensExtension {
  state: any;
  props: any;
  context: any;
  getCurrentLayer: any;
  defaultProps: any;
  parent: any;

  getShaders() {
    return {
      ...super.getShaders(),
      modules: [
        {
          name: "lens-module",
          fs,
          inject: {
            "fs:DECKGL_MUTATE_COLOR": `
       vec3 rgb = rgba.rgb;
       mutate_color(rgb, intensity0, intensity1, intensity2, intensity3, intensity4, intensity5, vTexCoord);
       rgba = vec4(rgb, 1.);
      `,
            "fs:#main-end": `
        //   bool isFragOnLensBounds = frag_on_lens_bounds(vTexCoord);
        //  gl_FragColor = (lensEnabled && isFragOnLensBounds) ? vec4(lensBorderColor, 1.) : gl_FragColor;
      `,
          },
        },
      ],
    };
  }
  initializeState() {
    // super.initializeState();
    if (this.context.deck) {
      this.context.deck.eventManager.on({
        pan: () => null,
        pointermove: () => null,
        pointerleave: () => null,
        wheel: () => null,
      });
    }
  }

  draw(): void {
    const layer = this.getCurrentLayer();
    const { viewportId } = layer.props;
    const { lensRadius = defaultProps.lensRadius.value } =
      this.parent.context.userData;
    const { lensOpacity = defaultProps.lensOpacity.value } =
      this.parent.context.userData;
    // If there is no viewportId, don't try to do anything.
    if (!viewportId) {
      layer.setState({ unprojectLensBounds: [0, 0, 0, 0] });
      return;
    }
    const mousePosition = {
      x: this.parent.context.userData.mousePosition[0],
      y: this.parent.context.userData.mousePosition[1],
    };
    const layerView = layer.context.deck.viewManager.views.filter(
      (view) => view.id === viewportId
    )[0];
    const viewState = layer.context.deck.viewManager.viewState[viewportId];
    const viewport = layerView.makeViewport({
      ...viewState,
      viewState,
    });
    // If the mouse is in the viewport and the mousePosition exists, set
    // the state with the bounding box of the circle that will render as a lens.
    if (mousePosition && viewport.containsPixel(mousePosition)) {
      const offsetMousePosition = {
        x: mousePosition.x - viewport.x,
        y: mousePosition.y - viewport.y,
      };
      const mousePositionBounds = [
        // left
        [offsetMousePosition.x - lensRadius, offsetMousePosition.y],
        // bottom
        [offsetMousePosition.x, offsetMousePosition.y + lensRadius],
        // right
        [offsetMousePosition.x + lensRadius, offsetMousePosition.y],
        // top
        [offsetMousePosition.x, offsetMousePosition.y - lensRadius],
      ];
      // Unproject from screen to world coordinates.
      const unprojectLensBounds = mousePositionBounds.map(
        (bounds, i) => viewport.unproject(bounds)[i % 2]
      );
      layer.setState({ unprojectLensBounds });
    } else {
      layer.setState({ unprojectLensBounds: [0, 0, 0, 0] });
    }
    this.state.model?.setUniforms({ lensOpacity: lensOpacity });
    super.draw();
  }
};

const LensLayer = class extends CompositeLayer {
  constructor(props) {
    super(props);
  }
  props: any;
  context: any;
  lensPosition: any;
  renderLayers() {
    const { id, viewState } = this.props;
    const mousePosition = this.context.userData.mousePosition || [
      Math.round((this.context.deck.width || 0) / 2),
      Math.round((this.context.deck.height || 0) / 2),
    ];
    this.lensPosition =
      this.context.deck.pickObject({
        x: mousePosition[0],
        y: mousePosition[1],
        radius: 1,
      })?.coordinate || viewState.target;

    const lensCircle = new ScatterplotLayer({
      id: `lens-circle-${id}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [this.lensPosition],
      pickable: true,
      animate: true,
      // opacity: 0.5,
      stroked: true,
      alphaCutoff: 0,
      filled: true,
      updateTriggers: {
        getPosition: Date.now() % 2000,
      },

      getFillColor: (d) => [0, 0, 0, 0],
      lineWidthMinPixels: 1,
      getPosition: (d) => {
        return d;
      },
      getRadius: (d) => {
        let multiplier = 1 / Math.pow(2, viewState.zoom);
        const size = this.context.userData.lensRadius * multiplier;
        return size;
      },
      getLineColor: (d) => [255, 255, 255],
      getLineWidth: (d) => {
        const multiplier = 1 / Math.pow(2, viewState.zoom);
        return 3 * multiplier;
      },
    });

    const resizeCircle = new ScatterplotLayer({
      id: `resize-circle-${id}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [this.lensPosition],
      pickable: true,
      animate: true,
      // opacity: 0.5,
      stroked: true,
      alphaCutoff: 0,
      filled: true,
      updateTriggers: {
        getPosition: Date.now() % 2000,
      },

      getFillColor: (d) => [0, 0, 0, 0],
      lineWidthMinPixels: 1,
      getPosition: (d) => {
        let multiplier = 1 / Math.pow(2, viewState.zoom);
        const resizeRadius = 20 * multiplier;
        const lensRadius = this.context.userData.lensRadius * multiplier;
        const distanceFromCenter = lensRadius + resizeRadius; // Adjusts distance between lens and circle
        const dx = Math.cos(Math.PI / 4) * distanceFromCenter;
        const dy = Math.sin(Math.PI / 4) * distanceFromCenter;
        return [d[0] + dx, d[1] + dy];
      },
      getRadius: (d) => {
        let multiplier = 1 / Math.pow(2, viewState.zoom);
        const resizeRadius = 20;

        const size = resizeRadius * multiplier;
        return size;
      },
      getLineColor: (d) => [255, 255, 255],
      getLineWidth: (d) => {
        const multiplier = 1 / Math.pow(2, viewState.zoom);
        return 3 * multiplier;
      },
    });

    // SVG points
    const svgPoints = [
      [190.367, 316.44],
      [190.367, 42.226],
      [236.352, 88.225],
      [251.958, 72.619],
      [179.333, 0],
      [106.714, 72.613],
      [122.291, 88.231],
      [168.302, 42.226],
      [168.302, 316.44],
      [122.314, 270.443],
      [106.708, 286.044],
      [179.333, 358.666],
      [251.958, 286.056],
      [236.363, 270.432],
    ];

    const avgPoint = svgPoints.reduce(
      (acc, point) => [
        acc[0] + point[0] / svgPoints.length,
        acc[1] + point[1] / svgPoints.length,
      ],
      [0, 0]
    );

    const normalizedSvgPoints = svgPoints.map((point) => [
      point[0] - avgPoint[0],
      point[1] - avgPoint[1],
    ]);

    const arrowLayer = new SolidPolygonLayer({
      id: `arrow-layer-${id}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [this.lensPosition],
      getPolygon: (d) => {
        let multiplier = 1 / Math.pow(2, viewState.zoom);
        const resizeRadius = 20 * multiplier;
        const lensRadius = this.context.userData.lensRadius * multiplier;
        const distanceFromCenter = lensRadius + resizeRadius;
        const dx = Math.cos(Math.PI / 4) * distanceFromCenter;
        const dy = Math.sin(Math.PI / 4) * distanceFromCenter;
        const center = [d[0] + dx, d[1] + dy];

        const scale = 0.1 * multiplier;

        const rotatePoint = (point, angle) => {
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const [x, y] = point;
          const rotatedX =
            cos * (x - center[0]) - sin * (y - center[1]) + center[0];
          const rotatedY =
            sin * (x - center[0]) + cos * (y - center[1]) + center[1];
          return [rotatedX, rotatedY];
        };

        // Rotate each SVG point by 45 degrees about its center, then scale and position them
        const transformedPoints = normalizedSvgPoints.map((point) => {
          const scaledPoint = [
            center[0] + point[0] * scale,
            center[1] + point[1] * scale,
          ];
          return rotatePoint(scaledPoint, -Math.PI / 4);
        });

        return transformedPoints;
      },
      getFillColor: [53, 121, 246],
      extruded: false,
      pickable: false,
    });

    const opacityLayer = new PolygonLayer({
      id: `opacity-layer-${id}`,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [this.lensPosition],
      getPolygon: (d) => {
        const opacity = this.context.userData.lensOpacity;
        const angle = (3 * Math.PI) / 2 - ((0.5 - opacity) * Math.PI) / 2;
        let multiplier = 1 / Math.pow(2, viewState.zoom);

        const lensRadius = this.context.userData.lensRadius * multiplier;

        const centerOfSemiCircle = [
          d[0] + Math.cos(angle) * lensRadius,
          d[1] + Math.sin(angle) * lensRadius,
        ];
        const size = 20 * multiplier;

        // Generate semicircle points
        const semiCirclePoints = [];
        for (
          let theta = angle + Math.PI / 2;
          theta <= (3 * Math.PI) / 2 + angle;
          theta += Math.PI / 36
        ) {
          // Change the denominator for more or fewer points
          semiCirclePoints.push([
            centerOfSemiCircle[0] - size * Math.cos(theta),
            centerOfSemiCircle[1] - size * Math.sin(theta),
          ]);
        }

        // Add center of the semicircle to close the shape
        // semiCirclePoints.push(centerOfSemiCircle);

        return semiCirclePoints;
      },
      getFillColor: [0, 0, 0, 0],
      getLineWidth: (d) => {
        const multiplier = 1 / Math.pow(2, viewState.zoom);
        return 3 * multiplier;
      },
      extruded: false,
      pickable: true,
      alphaCutoff: 0,
      stroked: true,
      getLineColor: [255, 255, 255],
    });

    return [lensCircle, resizeCircle, arrowLayer, opacityLayer];
  }
  onDrag(pickingInfo, event) {
    console.log("Drag", pickingInfo?.sourceLayer?.id);
    const { viewState } = this.props;
    this.context.userData.setMovingLens(true);

    if (pickingInfo?.sourceLayer?.id === `resize-circle-${this.props.id}`) {
      const lensCenter = this.context.userData.mousePosition;
      console.log("lensCenter", lensCenter, "event", event.offsetCenter);
      const xIntercept =
        (lensCenter[0] -
          lensCenter[1] +
          event.offsetCenter.x +
          event.offsetCenter.y) /
        2;
      const yIntercept = xIntercept + lensCenter[1] - lensCenter[0];
      const dx = xIntercept - lensCenter[0];
      const dy = yIntercept - lensCenter[1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      const resizeRadius = 20;
      const newRadius = distance - resizeRadius;
      this.context.userData.setLensRadius(newRadius);
    } else if (
      pickingInfo?.sourceLayer?.id === `opacity-layer-${this.props.id}`
    ) {
      // console.log("Opacity");
      const lensCenter = this.context.userData.mousePosition;
      const angle = Math.atan2(
        lensCenter[1] - event.offsetCenter.y,
        lensCenter[0] - event.offsetCenter.x
      );
      let opacity;
      if (angle < Math.PI / 4 && angle > -Math.PI / 2) {
        opacity = 0;
      } else if (angle > (3 * Math.PI) / 4 || angle < -Math.PI / 2) {
        opacity = 1;
      } else {
        opacity = (angle - Math.PI / 4) / (Math.PI / 2);
      }

      this.context.userData.setLensOpacity(opacity);

      // Calcualte angle between event.offsetCenter\ and lensCenter
    } else {
      console.log("pickingInfo", pickingInfo.sourceLayer.id);
      this.context.userData.setMousePosition([
        event.offsetCenter.x,
        event.offsetCenter.y,
      ]);
    }
  }

  onDragEnd(pickingInfo, event) {
    this.context.userData.setMovingLens(false);
  }
};
// @ts-ignore
LensLayer.layerName = "LensLayer";
// @ts-ignore
LensLayer.defaultProps = defaultProps;

class MinervaVivLensingDetailView extends VivView {
  props: any;
  mousePosition: any;
  lensRadius: any;
  lensOpacity: any;
  constructor(props) {
    super(props);
    this.mousePosition = props?.mousePosition || [null, null];
    this.lensRadius = props?.lensRadius;
    this.lensOpacity = props?.lensOpacity;
  }
  getLayers({ props, viewStates }) {
    const { loader } = props;
    const { id, height, width } = this;
    const layerViewState = viewStates[id];
    const layers = [getImageLayer(id, props)];

    // Inspect the first pixel source for physical sizes
    if (loader[0]?.meta?.physicalSizes?.x) {
      const { size, unit } = loader[0].meta.physicalSizes.x;
      layers.push(
        new LensLayer({
          id: getVivId(id),
          loader,
          unit,
          size,
          lensMousePosition: this.mousePosition,
          lensRadius: this.lensRadius,
          lensOpacity: this.lensOpacity,
          viewState: { ...layerViewState, height, width },
        })
      );
    }

    return layers;
  }
}

export { MinervaVivLensing, MinervaVivLensingDetailView };
