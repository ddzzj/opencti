import React, { Component } from 'react';
import * as PropTypes from 'prop-types';
import { compose, propOr } from 'ramda';
import { withRouter } from 'react-router-dom';
import { withStyles } from '@material-ui/core/styles';
import Slide from '@material-ui/core/Slide';
import inject18n from '../../../components/i18n';
import { QueryRenderer } from '../../../relay/environment';
import WorkflowLines, { workflowLinesQuery } from './workflow/WorkflowLines';
import SearchInput from '../../../components/SearchInput';
import {
  buildViewParamsFromUrlAndStorage,
  saveViewParameters,
} from '../../../utils/ListParameters';

const Transition = React.forwardRef((props, ref) => (
  <Slide direction="up" ref={ref} {...props} />
));
Transition.displayName = 'TransitionSlide';

const styles = () => ({
  container: {
    margin: 0,
    padding: 0,
  },
  parameters: {
    float: 'left',
    marginTop: -10,
  },
});

class Sessions extends Component {
  constructor(props) {
    super(props);
    const params = buildViewParamsFromUrlAndStorage(
      props.history,
      props.location,
      'view-workflow',
    );
    this.state = {
      searchTerm: propOr('', 'searchTerm', params),
      openExports: false,
    };
  }

  saveView() {
    saveViewParameters(
      this.props.history,
      this.props.location,
      'view-workflow',
      this.state,
    );
  }

  handleSearch(value) {
    this.setState({ searchTerm: value }, () => this.saveView());
  }

  render() {
    const { searchTerm } = this.state;
    const { classes } = this.props;
    return (
      <div className={classes.container}>
        <div className={classes.parameters}>
          <div style={{ float: 'left', marginRight: 20 }}>
            <SearchInput
              variant="small"
              onSubmit={this.handleSearch.bind(this)}
              keyword={searchTerm}
            />
          </div>
        </div>
        <div className="clearfix" />
        <QueryRenderer
          query={workflowLinesQuery}
          render={({ props }) => {
            if (props) {
              return <WorkflowLines data={props} keyword={searchTerm} />;
            }
            return <div />;
          }}
        />
      </div>
    );
  }
}

Sessions.propTypes = {
  t: PropTypes.func,
  classes: PropTypes.object,
  history: PropTypes.object,
  location: PropTypes.object,
};

export default compose(inject18n, withRouter, withStyles(styles))(Sessions);
