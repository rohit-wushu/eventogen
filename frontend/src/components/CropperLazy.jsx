// Thin wrapper around react-cropper used as a code-split chunk so the
// cropperjs library (~120 KB) only loads when a user actually starts
// cropping an image. Imported via React.lazy from places that need it.
import Cropper from 'react-cropper';
import 'cropperjs/dist/cropper.css';

export default Cropper;
