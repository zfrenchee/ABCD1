

let range = n => [...Array(n).keys()];
let clamp = (min, max) => ((x) => Math.min(Math.max(x, min), max));
let transpose = (array) => array[0].map((col, i) => array.map(row => row[i]));
let flatten = (array) => [].concat.apply([], array);

function Heatmap(samples_by_genes_matrix, gene_sets, classes) {

    // samples_by_genes_matrix: {'sample_id': {'gene1': float, 'gene2': float}};

    // gene_sets: {'gene_set_name': ['gene1', 'gene2']};

    // classes: {'sample_id': {'category1': 'value', 'category2': value}}

    // categories: ['column_name_of_sample_class_labels_1', 'column_name_of_sample_class_labels_2']
    var categories = _.uniq(_.flatten(Object.values(classes).map(obj => Object.keys(obj))));

    // categories_to_members_to_values: {'category': {'sample_id1': 'value', 'sample_id2': value}}
    var categories_to_members_to_values = _.object(categories.map((category) =>
        [category, _.object(Object.entries(classes).map(([sample_id, categories_to_values]) => [sample_id, categories_to_values[category]]))]
    ));

    // categories_to_values_to_members: {'category': {'value1': ['sample_id1', 'sample_id2']}}  <- I need this one
    var categories_to_values_to_members = _(categories_to_members_to_values).mapObject((samples_to_values) =>
        _(_(Object.entries(samples_to_values)).groupBy(([sample_id, value]) => value)).mapObject((arr_of_arr) => arr_of_arr.map(arr => arr[0]))
    );

    /////////////////////////////////////////////////////////////////////////////
                    ///////    Structure Variables    ///////
    /////////////////////////////////////////////////////////////////////////////

    var margin = {top: 100, right: 100, bottom: 0, left: 100};

    var w = window.innerWidth - (margin.left + margin.right);
    var h = window.innerHeight - (margin.top + margin.bottom);

    var values = 'zscore_stddev';
    var show_averages = false;
    var sorting = 'complete';
    var reordering = true;
    var minimum_nonzero = 0;

    value_accessors = {
        counts: (gene) => gene.counts,
        zscore_stddev: (gene) => gene.samples.map((sample) => sample.zscore_stddev),
        zscore_mad: (gene) => gene.samples.map((sample) => sample.zscore_mad),
        pc1: (gene) => gene.samples.map((sample) => sample.pc1),
    }
    value_accessor = value_accessors.counts;

    var ordered_sample_ids = [];
    var ordered_gene_ids = [];

    /////////////////////////////////////////////////////////////////////////////
                    ///////    Styling Variables    ///////
    /////////////////////////////////////////////////////////////////////////////

    var negative_color = '#0000cc';
    var middle_color = '#c0c0c0';
    var positive_color = '#cc0000';
    var show_legends = false;


    var colors20 = ["#3366cc", "#dc3912", "#ff9900", "#109618", "#990099", "#0099c6", "#dd4477",
                    "#66aa00", "#b82e2e", "#316395", "#994499", "#22aa99", "#aaaa11", "#6633cc",
                    "#e67300", "#8b0707", "#651067", "#329262", "#5574a6", "#3b3eac"];

    var colors = {};

    var spacing = 2;
    var rect_side_length = 16;
    var s = () => rect_side_length+spacing;

    /////////////////////////////////////////////////////////////////////////////
                          ///////    Set Up Chart    ///////
    /////////////////////////////////////////////////////////////////////////////

    var svg = d3.select("#graph-container").append("svg").attr("xmlns", "http://www.w3.org/2000/svg").attr("xmlns:xlink", "http://www.w3.org/1999/xlink");
    var g = svg.append("g").attr("transform", "translate("+margin.left+","+margin.top+")");
    svg.style("cursor", "move");

    var gene_set_name = "";
    var genes = [];
    var gene_wise = [];
    var gene_wise_indexer = {};
    var ordered_gene_wise = [];
    var sample_wise = [];
    var sample_wise_indexer = {};

    var y = (index) => axis_spacing*index;

    function idFunc(d) { return d ? d.id : this.id; }

    var rect = g.selectAll(".rect");
    var gSym = g.selectAll(".gSym");
    var sNam = g.selectAll(".sNam");
    var gGru = g.selectAll(".gGru");
    var meta = g.selectAll(".meta");

    var title = g.append("text")
                 .attr("class", "title")
                 .attr("font-family", "sans-serif")
                 .text("")
                 .style("text-anchor", "end")
                 .attr("dy", "-0.5em");

    var legend_color = g.append("g").attr("class", "legend legendColor");


    /////////////////////////////////////////////////////////////////////////////
                          ///////    Methods    ///////
    /////////////////////////////////////////////////////////////////////////////

    function restart({selected_gene_groups_=selected_gene_groups}={}) {

        selected_gene_groups = selected_gene_groups_;
        gene_set_name = selected_gene_groups[0].gene_set_name;
        genes = selected_gene_groups[0].genes;
        matrix = _(samples_by_genes_matrix).mapObject((sample) => _(sample).pick(genes));

        sample_wise = Object.entries(matrix).map(([sample, genes]) =>
            Object.entries(genes).map(([gene, count]) => { return {
                'id'     : sample+"_"+gene,
                'sample' : sample,
                'gene'   : gene,
                'count'  : count,
            }})
         );

        gene_wise = transpose(sample_wise).map((by_gene) => {
            min    = d3.min(by_gene, gene => gene.count);
            max    = d3.max(by_gene, gene => gene.count);
            mean   = d3.mean(by_gene, gene => gene.count);
            stddev = d3.deviation(by_gene, gene => gene.count);
            mad    = d3.mean(by_gene.map(gene => Math.abs(mean - gene.count)));
            num_nonzeros = by_gene.filter(d => d.count !== 0).length;
            return by_gene.map((gene) => Object.assign(gene, {
                'min'      : min,
                'max'      : max,
                'mean'     : mean,                  // should we only be counting non-zeros?
                'stddev'   : stddev,
                'mad'      : mad,
                'num_nonzeros'  : num_nonzeros,
                'zscore_stddev' : stddev === 0 ? 0 : (gene.count - mean) / stddev,
                'zscore_mad'    : mad === 0 ? 0    : (gene.count - mean) / mad,
            }));
        });

        gene_wise_indexer =  _.object(gene_wise.map((gene, i) => [gene[0].gene, i]));
        sample_wise_indexer = _.object(sample_wise.map((sample, i) => [sample[0].sample, i]));

        ordered_gene_wise = gene_wise;

        all_values = flatten(ordered_gene_wise);

        colors = {
            zscore_stddev:  d3.scaleLinear().domain([d3.min(all_values, d => d.zscore_stddev), 0, d3.max(all_values, d => d.zscore_stddev)]).range([negative_color, middle_color, positive_color]),
            zscore_mad:     d3.scaleLinear().domain([d3.min(all_values, d => d.zscore_mad),    0, d3.max(all_values, d => d.zscore_mad)]   ).range([negative_color, middle_color, positive_color]),
            pc1:            d3.scaleLinear().domain([d3.min(all_values, d => d.pc1),           0, d3.max(all_values, d => d.pc1)]          ).range([negative_color, middle_color, positive_color]),
        }

        order();
        render();

    }

    function order({values_=values,
                    sorting_=sorting,
                    minimum_nonzero_=minimum_nonzero}={}) {

        values = values_;
        value_accessor = value_accessors[values];
        sorting = sorting_;
        minimum_nonzero = minimum_nonzero_;
        if (minimum_nonzero > 0) { gene_set_name = "Genes"; }

        // THIS FUNCTION NOW ONLY NEEDS TO PRODUCE ARRAYS:
        // ordered_sample_ids
        // ordered_gene_ids

        // Filter by number non-zeros
        ordered_gene_wise = gene_wise.filter((gene) => gene[0].num_nonzeros >= minimum_nonzero);

        if (ordered_gene_wise.length === 0) { return; }

        // Set Gene-Wise PC1
        // genes_pc1 = reorder.pca1d(reorder.transpose(ordered_gene_wise.map(value_accessor)));
        // _(_.zip(ordered_gene_wise, genes_pc1)).each((gene, pc1) => gene.pc1 = pc1);

        // Order Genes
        if (reordering && ordered_gene_wise.length > 1) {

            if (sorting === 'pc1') {
                permutation_order = reorder.sort_order(genes_pc1);
            } else if (sorting === 'complete') {
                permutation_order = reorder.optimal_leaf_order()(ordered_gene_wise.map((bygene) => bygene.map(d => d[values])));  // get dendogram out?
            } else { console.log(' this should never happen '); }

            ordered_gene_wise = reorder.stablepermute(ordered_gene_wise, permutation_order);

        } else { permutation_order = range(ordered_gene_wise.length); }

        ordered_sample_ids = sample_wise.map((sample) => sample[0].sample);
        ordered_gene_ids = ordered_gene_wise.map((byGene) => byGene[0].gene)

    }

    function render({spacing_=spacing}={}) {

        spacing = spacing_;

        title.text(gene_set_name);

        x = d3.scalePoint().domain(ordered_sample_ids).range([0,(ordered_sample_ids.length-1)*s()]);
        y = d3.scalePoint().domain(ordered_gene_ids).range([0,(ordered_gene_ids.length-1)*s()]);

        rect = g.selectAll(".rect").data(flatten(ordered_gene_wise), idFunc);
        gSym = g.selectAll(".gSym").data(ordered_gene_ids, d => d);
        sNam = g.selectAll(".sNam").data(ordered_sample_ids, d => d);
        // gGru = g.selectAll(".gGru").data(gene_groups, (d) => d[0]);
        // meta = g.selectAll(".meta").data(Object.entries(categories_to_members_to_values), (d) => d[0]);

        // phase 1
            // rectangles which are exiting fade out
            // gene names which are exiting fade out
            // gene groups which are exiting fade out
        t_last = d3.transition().duration(200);
        if (rect.exit().size() > 0) {
            rect.exit().transition(t_last).style("opacity", 0).remove();
            gSym.exit().transition(t_last).style("opacity", 0).remove();
            sNam.exit().transition(t_last).style("opacity", 0).remove();
            // gGru.exit().transition(t_last).style("opacity", 0).remove();
            // meta.exit().transition(t_last).style("opacity", 0).remove();
            t_last = t_last.transition().duration(500);
        }

        // phase 2
            // re-arrange ROWS (rectangles, gene symbols, gene groups)
        rect.transition(t_last).attr('y', d => y(d.gene));
        gSym.transition(t_last).attr('y', d => y(d));
        sNam.transition(t_last).attr('transform', function (d) {
            current_x = d3.select(this).attr('transform').split("translate(")[1].split(",")[0];
            return "translate("+current_x+","+ordered_gene_ids.length*s()+")rotate(60)" });
        // gGru.transition(t_last)
        t_last = t_last.transition().duration(500);

        // phase 3
            // re-arrange COLUMNS (rectangles, sample names, meta)
        rect.transition(t_last).attr('x', d => x(d.sample)+10);
        sNam.transition(t_last).attr('transform', d => "translate("+(x(d)+s())+","+ordered_gene_ids.length*s()+")rotate(60)");
        // meta.transition(t_last)
        t_last = t_last.transition().duration(500);

        // phase 4
            // rectangles which are entering get appended
            // gene names which are entering get appended
            // gene groups which are entering get appended
        rect.enter()
            .append('rect')
            .attr('class', 'rect')
            .attr('id', d => d.id)
            .attr('x', d => x(d.sample)+10)
            .attr('y', d => y(d.gene))
            .attr('width', rect_side_length)
            .attr('height', rect_side_length)
            .attr('fill', d => colors[values](d[values]))
            .style("opacity", 0)
            .transition(t_last)
                .style("opacity", 1);

        gSym.enter()
            .append('text')
            .attr('class', 'gSym')
            .attr('id', d => d)
            .text(d => d)
            .attr('y', d => y(d))
            .attr("font-family", "sans-serif")
            .style("font-weight", 300)
            .style("cursor", "pointer")
            .style("text-anchor", "end")
            .attr("dy", "1em")
            .on("click", (d) => GeneCards(d))
            // .call(d3.drag().on("start", drag_axis_start).on("drag", drag_axis).on("end", drag_axis_end))
            .style("opacity", 0)
            .transition(t_last)
                .style("opacity", 1);

        sNam.enter()
            .append('text')
            .attr('class', 'sNam')
            .attr('id', d => d)
            .text(d => d)
            .attr('transform', d => "translate("+(x(d)+s())+","+ordered_gene_ids.length*s()+")rotate(60)")
            .attr("font-family", "sans-serif")
            .style("font-weight", 300)
            .style("cursor", "pointer")
            .style("text-anchor", "start")
            .attr("dy", "0.5em")
            // .call(d3.drag().on("start", drag_axis_start).on("drag", drag_axis).on("end", drag_axis_end))
            .style("opacity", 0)
            .transition(t_last)
                .style("opacity", 1);

        // gGru.enter()
        // meta.enter()

    }

    function style({negative_color_=negative_color,
                    middle_color_=middle_color,
                    positive_color_=positive_color,
                    show_legends_=show_legends}={}) {

        negative_color = negative_color_,
        middle_color = middle_color_,
        positive_color = positive_color_,
        show_legends=show_legends_;

        g.selectAll(".rect")
            .style("fill", (d) => colors[values](d[values]));



        if (show_legends) {

        } else {

        }

    }


    /////////////////////////////////////////////////////////////////////////////
                          ///////    Drag Axes    ///////
    /////////////////////////////////////////////////////////////////////////////

    function drag_axis_start(d) {}

    function drag_axis(d) {

        if (d3.select(this).attr("class") == 'gene_symbol') {

            accessor = 'gene';
            dragged_index = _(ordered_gene_wise[0]).findIndex((d2) => d2.sample === d);


        } else if (d3.select(this).attr("class") == 'sample_id') {

            accessor = 'sample';
            dragged_index = _(ordered_gene_wise).findIndex((byGene) => byGene[0].sample === d);

        }

        g.select("#"+d).attr("transform", function(d, i) { return "translate(0," +  expr(i) + ")" });
        g.selectAll(".rect").attr("transform", function(d, i) { return "translate(0," + (expr(i) - max_point_radius) + ")" });


        // let expr = (current_index) => {
        //     if (current_index < dragged_index) {
        //         if (current_index < ((d3.event.y-axis_spacing/2) / axis_spacing)) {
        //                 return y(current_index);
        //             } else {
        //                 return y(current_index) + axis_spacing;
        //             }
        //     } else {  // current_index >= dragged_index
        //         if (current_index < ((d3.event.y+axis_spacing/2) / axis_spacing)) {
        //                 return y(current_index) - axis_spacing;
        //             } else {
        //                 return y(current_index);
        //             }
        //     }
        // }


        // d3.select(this).attr("transform", "translate(0," + d3.event.y + ")");
        // d3.select(".dots#"+d[0]).attr("transform", (d, i) => "translate(0," + (d3.event.y - max_point_radius) + ")");

    }

    function drag_axis_end(d) {

        // dragged_index = _(ordered_gene_wise).findIndex((gene) => gene.id === d[0]);
        // old_index = dragged_index;
        // new_index = clamp(0, ordered_gene_wise.length)(Math.round(d3.event.y / axis_spacing));

        // ordered_gene_wise.splice(new_index, 0, ordered_gene_wise.splice(old_index, 1)[0]);
        // sample_wise.forEach((sample) => sample.genes.splice(new_index, 0, sample.genes.splice(old_index, 1)[0]));

        // render();

    }

    /////////////////////////////////////////////////////////////////////////////
                          ///////    Brush Axes    ///////
    /////////////////////////////////////////////////////////////////////////////


    function setFocus(d) {
    }

    function removeFocus(d) {
    }

    function GeneCards(d) { window.open("http://www.genecards.org/cgi-bin/carddisp.pl?gene="+d.id,'_blank') }


    /////////////////////////////////////////////////////////////////////////////
                          ///////   Zoom & Resize    ///////
    /////////////////////////////////////////////////////////////////////////////

    svg.call(d3.zoom()
               .scaleExtent([1 / 8, 8])
               .on("zoom", zoomed));

    function zoomed() { g.attr("transform", d3.event.transform); }

    function resize() {
        svg.attr("width", window.innerWidth).attr("height", window.innerHeight);
        w = window.innerWidth - (margin.left + margin.right);
        h = window.innerHeight - (margin.top + margin.bottom);
    }

    d3.select(window).on("resize", resize)

    resize();


    /////////////////////////////////////////////////////////////////////////////
                          ///////    Return    ///////
    /////////////////////////////////////////////////////////////////////////////

    return {
        'restart'     : restart,
        'render'      : render,
        'order'       : order,
        'style'       : style,

        get_sorted_gene_list: () => _(sample_wise[0]).pluck('gene'),

        set_reordering: (reordering_) => { reordering = reordering_; if (reordering) { order(); render(); } },
    }

}




